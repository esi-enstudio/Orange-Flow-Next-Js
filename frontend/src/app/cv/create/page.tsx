"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { ChevronLeft, Plus, Trash2, Loader2, Save, FileText, Upload, ImageIcon } from "lucide-react";
import { useLanguage } from "@/i18n/useLanguage";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { toast } from "react-hot-toast";
import type { CVFormData, EducationalQualification, ProfessionalExperience } from "@/types/cv";

const initialFormData: CVFormData = {
  name: "",
  care_of: "",
  mobile: "",
  fathers_name: "",
  mothers_name: "",
  permanent_address: "",
  date_of_birth: "",
  nid_number: "",
  nationality: "Bangladeshi",
  religion: "",
  marital_status: "",
  blood_group: "",
  educational_qualifications: [],
  professional_experiences: [],
  language_proficiency: "",
  photo_url: "",
  signature_url: "",
  declaration_text: "I, the undersigned, certify that all information stated herein is true and correct.",
  signature_name: "",
  declaration_date: "",
};

const emptyEdu: EducationalQualification = { degree: "", group_subject: "", board: "", result: "", institution: "", passing_year: 2026 };
const emptyExp: ProfessionalExperience = { institution: "", designation: "", duration: "", responsibilities: [] };

export default function CreateCVPage() {
  const { hasPermission, loading: authLoading } = useAuth();
  const router = useRouter();
  const { t } = useLanguage();
  const [formData, setFormData] = useState<CVFormData>(initialFormData);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
  const [pendingSig, setPendingSig] = useState<File | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadingSig, setUploadingSig] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const sigInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!authLoading && !hasPermission("cv.create")) router.push("/cv");
  }, [authLoading, hasPermission, router]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: "" }));
  };

  const handleEduChange = (index: number, field: keyof EducationalQualification, value: string | number) => {
    setFormData(prev => {
      const edu = [...prev.educational_qualifications];
      edu[index] = { ...edu[index], [field]: value };
      return { ...prev, educational_qualifications: edu };
    });
  };

  const handleExpChange = (index: number, field: keyof ProfessionalExperience, value: string) => {
    setFormData(prev => {
      const exp = [...prev.professional_experiences];
      exp[index] = { ...exp[index], [field]: value };
      return { ...prev, professional_experiences: exp };
    });
  };

  const handleRespChange = (expIndex: number, respIndex: number, value: string) => {
    setFormData(prev => {
      const exp = [...prev.professional_experiences];
      const resp = [...(exp[expIndex].responsibilities || [])];
      resp[respIndex] = value;
      exp[expIndex] = { ...exp[expIndex], responsibilities: resp };
      return { ...prev, professional_experiences: exp };
    });
  };

  const addEducation = () => setFormData(prev => ({
    ...prev,
    educational_qualifications: [...prev.educational_qualifications, { ...emptyEdu }],
  }));

  const removeEducation = (index: number) => setFormData(prev => ({
    ...prev,
    educational_qualifications: prev.educational_qualifications.filter((_, i) => i !== index),
  }));

  const addExperience = () => setFormData(prev => ({
    ...prev,
    professional_experiences: [...prev.professional_experiences, { ...emptyExp }],
  }));

  const removeExperience = (index: number) => setFormData(prev => ({
    ...prev,
    professional_experiences: prev.professional_experiences.filter((_, i) => i !== index),
  }));

  const handleFileSelect = (file: File, type: "photo" | "signature") => {
    if (type === "photo") setPendingPhoto(file);
    else setPendingSig(file);
    const previewUrl = URL.createObjectURL(file);
    setFormData(prev => ({ ...prev, [type === "photo" ? "photo_url" : "signature_url"]: previewUrl }));
  };

  const uploadPendingFiles = async (slug: string) => {
    if (pendingPhoto) {
      setUploadingPhoto(true);
      try {
        const form = new FormData();
        form.append("file", pendingPhoto);
        const res = await apiClient.post(`cv/${slug}/upload-photo`, form);
        setFormData(prev => ({ ...prev, photo_url: res.data.url }));
      } catch { /* ignore */ }
      setUploadingPhoto(false);
    }
    if (pendingSig) {
      setUploadingSig(true);
      try {
        const form = new FormData();
        form.append("file", pendingSig);
        const res = await apiClient.post(`cv/${slug}/upload-signature`, form);
        setFormData(prev => ({ ...prev, signature_url: res.data.url }));
      } catch { /* ignore */ }
      setUploadingSig(false);
    }
  };

  const addResponsibility = (expIndex: number) => {
    setFormData(prev => {
      const exp = [...prev.professional_experiences];
      exp[expIndex] = { ...exp[expIndex], responsibilities: [...(exp[expIndex].responsibilities || []), ""] };
      return { ...prev, professional_experiences: exp };
    });
  };

  const removeResponsibility = (expIndex: number, respIndex: number) => {
    setFormData(prev => {
      const exp = [...prev.professional_experiences];
      exp[expIndex] = {
        ...exp[expIndex],
        responsibilities: exp[expIndex].responsibilities.filter((_, i) => i !== respIndex),
      };
      return { ...prev, professional_experiences: exp };
    });
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!formData.name.trim()) errs.name = "Name is required";
    if (!formData.mobile.trim()) errs.mobile = "Mobile is required";
    if (!formData.fathers_name.trim()) errs.fathers_name = "Father's name is required";
    if (!formData.mothers_name.trim()) errs.mothers_name = "Mother's name is required";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const payload = {
        ...formData,
        photo_url: pendingPhoto ? "" : formData.photo_url,
        signature_url: pendingSig ? "" : formData.signature_url,
        date_of_birth: formData.date_of_birth || null,
        declaration_date: formData.declaration_date || null,
      };
      const res = await apiClient.post("cv", payload);
      const newSlug = res.data?.data?.slug;
      if (newSlug && (pendingPhoto || pendingSig)) {
        await uploadPendingFiles(newSlug);
      }
      toast.success("CV created successfully!");
      router.push(newSlug ? `/cv/${newSlug}` : "/cv");
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to create CV");
    } finally {
      setSaving(false);
    }
  };

  if (!authLoading && !hasPermission("cv.view")) return <AccessDenied />;

  const inputCls = "w-full px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none text-sm";
  const labelCls = "block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1";

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <button onClick={() => router.push("/cv")} className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 mb-6 transition-colors">
          <ChevronLeft className="w-4 h-4" /> Back to CV List
        </button>

        <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-gray-200 dark:border-slate-700 p-8">
          <div className="text-center mb-8">
            <FileText className="w-10 h-10 mx-auto text-primary-500 mb-2" />
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">CURRICULUM VITAE</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Fill in your details below</p>
          </div>

          <Section title="Header Information">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Full Name *" error={errors.name}>
                <input name="name" value={formData.name} onChange={handleChange} className={inputCls} placeholder="MD MOBASHIR AHMED" />
              </Field>
              <Field label="C/O" error={errors.care_of}>
                <input name="care_of" value={formData.care_of} onChange={handleChange} className={inputCls} placeholder="MD RUBEL MIA" />
              </Field>
              <Field label="Mobile *" error={errors.mobile}>
                <input name="mobile" value={formData.mobile} onChange={handleChange} className={inputCls} placeholder="01752755036" />
              </Field>
            </div>
          </Section>

          <Section title="PERSONAL INFORMATION">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Father's Name *" error={errors.fathers_name}>
                <input name="fathers_name" value={formData.fathers_name} onChange={handleChange} className={inputCls} placeholder="Md Rubel Mia" />
              </Field>
              <Field label="Mother's Name *" error={errors.mothers_name}>
                <input name="mothers_name" value={formData.mothers_name} onChange={handleChange} className={inputCls} placeholder="Mst Shipli Shikder" />
              </Field>
              <Field label="Permanent Address">
                <textarea name="permanent_address" value={formData.permanent_address} onChange={handleChange} className={`${inputCls} min-h-[60px]`} placeholder="Village, P.O, P.S, District" rows={2} />
              </Field>
              <Field label="Date of Birth">
                <input type="date" name="date_of_birth" value={formData.date_of_birth} onChange={handleChange} className={inputCls} />
              </Field>
              <Field label="NID Number">
                <input name="nid_number" value={formData.nid_number} onChange={handleChange} className={inputCls} placeholder="1031077470" />
              </Field>
              <Field label="Nationality">
                <input name="nationality" value={formData.nationality} onChange={handleChange} className={inputCls} placeholder="Bangladeshi" />
              </Field>
              <Field label="Religion">
                <input name="religion" value={formData.religion} onChange={handleChange} className={inputCls} placeholder="Islam" />
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

          <Section title="PHOTO & SIGNATURE">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Photo</label>
                <div className="flex items-start gap-3">
                  <div className="w-24 h-24 rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden bg-gray-50 dark:bg-slate-700 shrink-0 flex items-center justify-center">
                    {formData.photo_url ? (
                      <img src={formData.photo_url} alt="Photo" className="w-full h-full object-cover" />
                    ) : (
                      <ImageIcon className="w-8 h-8 text-gray-300 dark:text-gray-500" />
                    )}
                  </div>
                  <div className="flex-1">
                    <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelect(f, "photo"); }} />
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
                      <img src={formData.signature_url} alt="Signature" className="w-full h-full object-contain" />
                    ) : (
                      <ImageIcon className="w-6 h-6 text-gray-300 dark:text-gray-500" />
                    )}
                  </div>
                  <div className="flex-1">
                    <input ref={sigInputRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelect(f, "signature"); }} />
                    <button type="button" onClick={() => sigInputRef.current?.click()} disabled={uploadingSig} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors">
                      {uploadingSig ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                      {uploadingSig ? "Uploading..." : "Upload Signature"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </Section>

          <Section title="EDUCATIONAL QUALIFICATION">
            {formData.educational_qualifications.map((edu, i) => (
              <div key={i} className="relative p-4 mb-3 border border-gray-200 dark:border-slate-700 rounded-lg bg-gray-50 dark:bg-slate-800/50">
                <button type="button" onClick={() => removeEducation(i)} className="absolute top-2 right-2 p-1 text-red-400 hover:text-red-600 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Field label="Degree">
                    <input value={edu.degree} onChange={e => handleEduChange(i, "degree", e.target.value)} className={inputCls} placeholder="HSC / SSC" />
                  </Field>
                  <Field label="Group/Subject">
                    <input value={edu.group_subject} onChange={e => handleEduChange(i, "group_subject", e.target.value)} className={inputCls} placeholder="Humanities / Science" />
                  </Field>
                  <Field label="Board">
                    <input value={edu.board} onChange={e => handleEduChange(i, "board", e.target.value)} className={inputCls} placeholder="Dhaka" />
                  </Field>
                  <Field label="Result (GPA)">
                    <input value={edu.result} onChange={e => handleEduChange(i, "result", e.target.value)} className={inputCls} placeholder="3.83" />
                  </Field>
                  <Field label="Institution">
                    <input value={edu.institution} onChange={e => handleEduChange(i, "institution", e.target.value)} className={inputCls} placeholder="School/College name" />
                  </Field>
                  <Field label="Passing Year">
                    <input type="number" value={edu.passing_year} onChange={e => handleEduChange(i, "passing_year", parseInt(e.target.value) || 2026)} className={inputCls} placeholder="2021" />
                  </Field>
                </div>
              </div>
            ))}
            <button type="button" onClick={addEducation} className="inline-flex items-center gap-1.5 text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 transition-colors">
              <Plus className="w-4 h-4" /> Add Education
            </button>
          </Section>

          <Section title="PROFESSIONAL EXPERIENCE">
            {formData.professional_experiences.map((exp, i) => (
              <div key={i} className="relative p-4 mb-3 border border-gray-200 dark:border-slate-700 rounded-lg bg-gray-50 dark:bg-slate-800/50">
                <button type="button" onClick={() => removeExperience(i)} className="absolute top-2 right-2 p-1 text-red-400 hover:text-red-600 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <Field label="Institution">
                    <input value={exp.institution} onChange={e => handleExpChange(i, "institution", e.target.value)} className={inputCls} placeholder="Banglalink Distribution House" />
                  </Field>
                  <Field label="Designation">
                    <input value={exp.designation} onChange={e => handleExpChange(i, "designation", e.target.value)} className={inputCls} placeholder="Supervisor" />
                  </Field>
                  <Field label="Duration">
                    <input value={exp.duration} onChange={e => handleExpChange(i, "duration", e.target.value)} className={inputCls} placeholder="2 Years Experience" />
                  </Field>
                </div>
                <div className="mt-3">
                  <p className={`${labelCls} text-xs`}>Responsibilities</p>
                  {exp.responsibilities.map((resp, ri) => (
                    <div key={ri} className="flex items-center gap-2 mb-1.5">
                      <input value={resp} onChange={e => handleRespChange(i, ri, e.target.value)} className={`${inputCls} flex-1`} placeholder="e.g. Supervised daily operations" />
                      <button type="button" onClick={() => removeResponsibility(i, ri)} className="p-1 text-red-400 hover:text-red-600 shrink-0">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  <button type="button" onClick={() => addResponsibility(i)} className="text-xs text-primary-600 dark:text-primary-400 hover:text-primary-700 inline-flex items-center gap-1 mt-1">
                    <Plus className="w-3 h-3" /> Add Responsibility
                  </button>
                </div>
              </div>
            ))}
            <button type="button" onClick={addExperience} className="inline-flex items-center gap-1.5 text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 transition-colors">
              <Plus className="w-4 h-4" /> Add Experience
            </button>
          </Section>

          <Section title="LANGUAGE PROFICIENCY">
            <textarea
              name="language_proficiency"
              value={formData.language_proficiency}
              onChange={handleChange}
              className={`${inputCls} min-h-[60px]`}
              placeholder="Good command over speaking and writing both Bengali and English."
              rows={2}
            />
          </Section>

          <Section title="DECLARATION">
            <textarea
              name="declaration_text"
              value={formData.declaration_text}
              onChange={handleChange}
              className={`${inputCls} min-h-[60px]`}
              rows={2}
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <Field label="Signature Name">
                <input name="signature_name" value={formData.signature_name} onChange={handleChange} className={inputCls} placeholder="Md. Mobashir Ahmed" />
              </Field>
              <Field label="Date">
                <input type="date" name="declaration_date" value={formData.declaration_date} onChange={handleChange} className={inputCls} />
              </Field>
            </div>
          </Section>

          <div className="flex items-center gap-3 mt-8 pt-6 border-t border-gray-200 dark:border-slate-700">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors font-medium"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? "Saving..." : "Save CV"}
            </button>
            <button
              type="button"
              onClick={() => router.push("/cv")}
              className="px-6 py-2.5 border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors font-medium"
            >
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
      <h2 className="text-sm font-bold text-gray-800 dark:text-gray-200 uppercase tracking-wider mb-3 pb-1.5 border-b border-gray-200 dark:border-slate-700">
        {title}
      </h2>
      {children}
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{label}</label>
      {children}
      {error && <p className="text-xs text-red-500 mt-0.5">{error}</p>}
    </div>
  );
}
