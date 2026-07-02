"use client";
import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import apiClient, { resolveImageUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { ChevronLeft, Plus, Trash2, Loader2, Save, FileText, Upload, ImageIcon } from "lucide-react";
import { useLanguage } from "@/i18n/useLanguage";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { toast } from "react-hot-toast";
import type { CVFormData, EducationalQualification, ProfessionalExperience } from "@/types/cv";

const emptyEdu: EducationalQualification = { degree: "", group_subject: "", board: "", result: "", institution: "", passing_year: 2026 };
const emptyExp: ProfessionalExperience = { institution: "", designation: "", duration: "", responsibilities: [] };

export default function EditCVPage() {
  const { slug } = useParams<{ slug: string }>();
  const { hasPermission, loading: authLoading } = useAuth();
  const router = useRouter();
  const { t } = useLanguage();
  const [formData, setFormData] = useState<CVFormData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadingSig, setUploadingSig] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const sigInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!authLoading && !hasPermission("cv.edit")) router.push(`/cv/${slug}`);
  }, [authLoading, hasPermission, router, slug]);

  useEffect(() => {
    if (!authLoading && hasPermission("cv.view") && slug) {
      fetchCV();
    }
  }, [slug, authLoading]);

  const fetchCV = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get(`cv/${slug}`);
      const cv = res.data.data;
      setFormData({
        name: cv.name || "",
        care_of: cv.care_of || "",
        mobile: cv.mobile || "",
        fathers_name: cv.fathers_name || "",
        mothers_name: cv.mothers_name || "",
        permanent_address: cv.permanent_address || "",
        date_of_birth: cv.date_of_birth ? cv.date_of_birth.split("T")[0] : "",
        nid_number: cv.nid_number || "",
        nationality: cv.nationality || "Bangladeshi",
        religion: cv.religion || "",
        marital_status: cv.marital_status || "",
        blood_group: cv.blood_group || "",
        educational_qualifications: cv.educational_qualifications || [],
        professional_experiences: cv.professional_experiences || [],
        language_proficiency: cv.language_proficiency || "",
        declaration_text: cv.declaration_text || "",
        photo_url: cv.photo_url || "",
        signature_url: cv.signature_url || "",
        signature_name: cv.signature_name || "",
        declaration_date: cv.declaration_date ? cv.declaration_date.split("T")[0] : "",
      });
    } catch {
      toast.error("Failed to load CV");
      router.push("/cv");
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => prev ? { ...prev, [name]: value } : prev);
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: "" }));
  };

  const handleEduChange = (index: number, field: keyof EducationalQualification, value: string | number) => {
    setFormData(prev => {
      if (!prev) return prev;
      const edu = [...prev.educational_qualifications];
      edu[index] = { ...edu[index], [field]: value };
      return { ...prev, educational_qualifications: edu };
    });
  };

  const handleExpChange = (index: number, field: keyof ProfessionalExperience, value: string) => {
    setFormData(prev => {
      if (!prev) return prev;
      const exp = [...prev.professional_experiences];
      exp[index] = { ...exp[index], [field]: value };
      return { ...prev, professional_experiences: exp };
    });
  };

  const handleRespChange = (expIndex: number, respIndex: number, value: string) => {
    setFormData(prev => {
      if (!prev) return prev;
      const exp = [...prev.professional_experiences];
      const resp = [...(exp[expIndex].responsibilities || [])];
      resp[respIndex] = value;
      exp[expIndex] = { ...exp[expIndex], responsibilities: resp };
      return { ...prev, professional_experiences: exp };
    });
  };

  const addEducation = () => setFormData(prev => prev ? { ...prev, educational_qualifications: [...prev.educational_qualifications, { ...emptyEdu }] } : prev);
  const removeEducation = (index: number) => setFormData(prev => prev ? { ...prev, educational_qualifications: prev.educational_qualifications.filter((_, i) => i !== index) } : prev);
  const addExperience = () => setFormData(prev => prev ? { ...prev, professional_experiences: [...prev.professional_experiences, { ...emptyExp }] } : prev);
  const removeExperience = (index: number) => setFormData(prev => prev ? { ...prev, professional_experiences: prev.professional_experiences.filter((_, i) => i !== index) } : prev);
  const addResponsibility = (expIndex: number) => setFormData(prev => {
    if (!prev) return prev;
    const exp = [...prev.professional_experiences];
    exp[expIndex] = { ...exp[expIndex], responsibilities: [...(exp[expIndex].responsibilities || []), ""] };
    return { ...prev, professional_experiences: exp };
  });
  const removeResponsibility = (expIndex: number, respIndex: number) => setFormData(prev => {
    if (!prev) return prev;
    const exp = [...prev.professional_experiences];
    exp[expIndex] = { ...exp[expIndex], responsibilities: exp[expIndex].responsibilities.filter((_, i) => i !== respIndex) };
    return { ...prev, professional_experiences: exp };
  });

  const handleFileUpload = async (file: File, type: "photo" | "signature") => {
    const form = new FormData();
    form.append("file", file);
    const endpoint = type === "photo" ? "upload-photo" : "upload-signature";
    const setter = type === "photo" ? setUploadingPhoto : setUploadingSig;
    setter(true);
    try {
      const res = await apiClient.post(`cv/${slug}/${endpoint}`, form);
      const url = res.data.url;
      setFormData(prev => prev ? { ...prev, [type === "photo" ? "photo_url" : "signature_url"]: url } : prev);
      toast.success(`${type === "photo" ? "Photo" : "Signature"} uploaded successfully`);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || `Failed to upload ${type}`);
    } finally {
      setter(false);
    }
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!formData?.name.trim()) errs.name = "Name is required";
    if (!formData?.mobile.trim()) errs.mobile = "Mobile is required";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate() || !formData) return;
    setSaving(true);
    try {
      const payload = {
        ...formData,
        date_of_birth: formData.date_of_birth || null,
        declaration_date: formData.declaration_date || null,
      };
      const res = await apiClient.put(`cv/${slug}`, payload);
      const updatedSlug = res.data?.data?.slug || slug;
      toast.success("CV updated successfully!");
      router.push(`/cv/${updatedSlug}`);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to update CV");
    } finally {
      setSaving(false);
    }
  };

  if (!authLoading && !hasPermission("cv.view")) return <AccessDenied />;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  if (!formData) return null;

  const inputCls = "w-full px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none text-sm";
  const labelCls = "block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1";

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <button onClick={() => router.push(`/cv/${slug}`)} className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 mb-6 transition-colors">
          <ChevronLeft className="w-4 h-4" /> Back to CV
        </button>

        <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-gray-200 dark:border-slate-700 p-8">
          <div className="text-center mb-8">
            <FileText className="w-10 h-10 mx-auto text-primary-500 mb-2" />
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Edit CV</h1>
          </div>

          <Section title="Header Information">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Full Name *" error={errors.name}>
                <input name="name" value={formData.name} onChange={handleChange} className={inputCls} />
              </Field>
              <Field label="C/O">
                <input name="care_of" value={formData.care_of} onChange={handleChange} className={inputCls} />
              </Field>
              <Field label="Mobile *" error={errors.mobile}>
                <input name="mobile" value={formData.mobile} onChange={handleChange} className={inputCls} />
              </Field>
            </div>
          </Section>

          <Section title="PERSONAL INFORMATION">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Father's Name">
                <input name="fathers_name" value={formData.fathers_name} onChange={handleChange} className={inputCls} />
              </Field>
              <Field label="Mother's Name">
                <input name="mothers_name" value={formData.mothers_name} onChange={handleChange} className={inputCls} />
              </Field>
              <Field label="Permanent Address" className="md:col-span-2">
                <textarea name="permanent_address" value={formData.permanent_address} onChange={handleChange} className={`${inputCls} min-h-[60px]`} rows={2} />
              </Field>
              <Field label="Date of Birth">
                <input type="date" name="date_of_birth" value={formData.date_of_birth} onChange={handleChange} className={inputCls} />
              </Field>
              <Field label="NID Number">
                <input name="nid_number" value={formData.nid_number} onChange={handleChange} className={inputCls} />
              </Field>
              <Field label="Nationality">
                <input name="nationality" value={formData.nationality} onChange={handleChange} className={inputCls} />
              </Field>
              <Field label="Religion">
                <input name="religion" value={formData.religion} onChange={handleChange} className={inputCls} />
              </Field>
              <Field label="Marital Status">
                <select name="marital_status" value={formData.marital_status} onChange={handleChange} className={inputCls}>
                  <option value="">Select...</option>
                  <option value="Married">Married</option>
                  <option value="Unmarried">Unmarried</option>
                  <option value="Divorced">Divorced</option>
                  <option value="Widowed">Widowed</option>
                </select>
              </Field>
              <Field label="Blood Group">
                <select name="blood_group" value={formData.blood_group} onChange={handleChange} className={inputCls}>
                  <option value="">Select...</option>
                  {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map(bg => (
                    <option key={bg} value={bg}>{bg}</option>
                  ))}
                </select>
              </Field>
            </div>
          </Section>

          <Section title="EDUCATIONAL QUALIFICATION">
            {formData.educational_qualifications.map((edu, i) => (
              <div key={i} className="relative p-4 mb-3 border border-gray-200 dark:border-slate-700 rounded-lg bg-gray-50 dark:bg-slate-800/50">
                <button type="button" onClick={() => removeEducation(i)} className="absolute top-2 right-2 p-1 text-red-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Field label="Degree"><input value={edu.degree} onChange={e => handleEduChange(i, "degree", e.target.value)} className={inputCls} /></Field>
                  <Field label="Group"><input value={edu.group_subject} onChange={e => handleEduChange(i, "group_subject", e.target.value)} className={inputCls} /></Field>
                  <Field label="Board"><input value={edu.board} onChange={e => handleEduChange(i, "board", e.target.value)} className={inputCls} /></Field>
                  <Field label="Result"><input value={edu.result} onChange={e => handleEduChange(i, "result", e.target.value)} className={inputCls} /></Field>
                  <Field label="Institution"><input value={edu.institution} onChange={e => handleEduChange(i, "institution", e.target.value)} className={inputCls} /></Field>
                  <Field label="Year"><input type="number" value={edu.passing_year} onChange={e => handleEduChange(i, "passing_year", parseInt(e.target.value) || 2026)} className={inputCls} /></Field>
                </div>
              </div>
            ))}
            <button type="button" onClick={addEducation} className="inline-flex items-center gap-1.5 text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700">
              <Plus className="w-4 h-4" /> Add Education
            </button>
          </Section>

          <Section title="PROFESSIONAL EXPERIENCE">
            {formData.professional_experiences.map((exp, i) => (
              <div key={i} className="relative p-4 mb-3 border border-gray-200 dark:border-slate-700 rounded-lg bg-gray-50 dark:bg-slate-800/50">
                <button type="button" onClick={() => removeExperience(i)} className="absolute top-2 right-2 p-1 text-red-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <Field label="Institution"><input value={exp.institution} onChange={e => handleExpChange(i, "institution", e.target.value)} className={inputCls} /></Field>
                  <Field label="Designation"><input value={exp.designation} onChange={e => handleExpChange(i, "designation", e.target.value)} className={inputCls} /></Field>
                  <Field label="Duration"><input value={exp.duration} onChange={e => handleExpChange(i, "duration", e.target.value)} className={inputCls} /></Field>
                </div>
                <div className="mt-3">
                  <p className={labelCls}>Responsibilities</p>
                  {exp.responsibilities.map((resp, ri) => (
                    <div key={ri} className="flex items-center gap-2 mb-1.5">
                      <input value={resp} onChange={e => handleRespChange(i, ri, e.target.value)} className={`${inputCls} flex-1`} />
                      <button type="button" onClick={() => removeResponsibility(i, ri)} className="p-1 text-red-400 hover:text-red-600 shrink-0"><Trash2 className="w-3 h-3" /></button>
                    </div>
                  ))}
                  <button type="button" onClick={() => addResponsibility(i)} className="text-xs text-primary-600 dark:text-primary-400 hover:text-primary-700 inline-flex items-center gap-1 mt-1">
                    <Plus className="w-3 h-3" /> Add Responsibility
                  </button>
                </div>
              </div>
            ))}
            <button type="button" onClick={addExperience} className="inline-flex items-center gap-1.5 text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700">
              <Plus className="w-4 h-4" /> Add Experience
            </button>
          </Section>

          <Section title="LANGUAGE PROFICIENCY">
            <textarea name="language_proficiency" value={formData.language_proficiency} onChange={handleChange} className={`${inputCls} min-h-[60px]`} rows={2} />
          </Section>

          <Section title="PHOTO & SIGNATURE">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Photo</label>
                <div className="flex items-start gap-3">
                  <div className="w-24 h-24 rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden bg-gray-50 dark:bg-slate-700 shrink-0 flex items-center justify-center">
                    {formData.photo_url ? (
                      <img src={resolveImageUrl(formData.photo_url) || ""} alt="Photo" className="w-full h-full object-cover" />
                    ) : (
                      <ImageIcon className="w-8 h-8 text-gray-300 dark:text-gray-500" />
                    )}
                  </div>
                  <div className="flex-1">
                    <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f, "photo"); }} />
                    <button type="button" onClick={() => photoInputRef.current?.click()} disabled={uploadingPhoto} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors">
                      {uploadingPhoto ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                      {uploadingPhoto ? "Uploading..." : "Upload Photo"}
                    </button>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Signature</label>
                <div className="flex items-start gap-3">
                  <div className="w-28 h-14 rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden bg-gray-50 dark:bg-slate-700 shrink-0 flex items-center justify-center">
                    {formData.signature_url ? (
                      <img src={resolveImageUrl(formData.signature_url) || ""} alt="Signature" className="w-full h-full object-contain" />
                    ) : (
                      <ImageIcon className="w-6 h-6 text-gray-300 dark:text-gray-500" />
                    )}
                  </div>
                  <div className="flex-1">
                    <input ref={sigInputRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f, "signature"); }} />
                    <button type="button" onClick={() => sigInputRef.current?.click()} disabled={uploadingSig} className="mt-2 inline-flex items-center gap-1.5 text-xs px-3 py-1.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors">
                      {uploadingSig ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                      {uploadingSig ? "Uploading..." : "Upload Signature"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </Section>

          <Section title="DECLARATION">
            <textarea name="declaration_text" value={formData.declaration_text} onChange={handleChange} className={`${inputCls} min-h-[60px]`} rows={2} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <Field label="Signature Name"><input name="signature_name" value={formData.signature_name} onChange={handleChange} className={inputCls} /></Field>
              <Field label="Date"><input type="date" name="declaration_date" value={formData.declaration_date} onChange={handleChange} className={inputCls} /></Field>
            </div>
          </Section>

          <div className="flex items-center gap-3 mt-8 pt-6 border-t border-gray-200 dark:border-slate-700">
            <button type="submit" disabled={saving} className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 font-medium">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? "Saving..." : "Update CV"}
            </button>
            <button type="button" onClick={() => router.push(`/cv/${slug}`)} className="px-6 py-2.5 border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 font-medium">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="text-sm font-bold text-gray-800 dark:text-gray-200 uppercase tracking-wider mb-3 pb-1.5 border-b border-gray-200 dark:border-slate-700">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, error, children, className }: { label: string; error?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{label}</label>
      {children}
      {error && <p className="text-xs text-red-500 mt-0.5">{error}</p>}
    </div>
  );
}
