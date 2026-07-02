"use client";
import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import apiClient, { resolveImageUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { ChevronLeft, Download, FileText, Printer, Loader2, FileDown } from "lucide-react";
import { useLanguage } from "@/i18n/useLanguage";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { toast } from "react-hot-toast";
import type { CV } from "@/types/cv";

export default function CVPreviewPage() {
  const { slug } = useParams<{ slug: string }>();
  const { hasPermission, loading: authLoading } = useAuth();
  const router = useRouter();
  const { t } = useLanguage();
  const [cv, setCv] = useState<CV | null>(null);
  const [loading, setLoading] = useState(true);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingWord, setExportingWord] = useState(false);
  const cvRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!authLoading && !hasPermission("cv.view")) router.push("/cv");
  }, [authLoading, hasPermission, router]);

  useEffect(() => {
    if (!authLoading && hasPermission("cv.view") && slug) {
      fetchCV();
    }
  }, [slug, authLoading]);

  const fetchCV = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get(`cv/${slug}`);
      setCv(res.data.data);
    } catch {
      toast.error("Failed to load CV");
      router.push("/cv");
    } finally {
      setLoading(false);
    }
  };

  const handleExportPDF = async () => {
    if (!cvRef.current) return;
    setExportingPdf(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const { jsPDF } = await import("jspdf");
      const canvas = await html2canvas(cvRef.current, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: "#ffffff",
      });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      let heightLeft = pdfHeight;
      let position = 0;
      const pageHeight = pdf.internal.pageSize.getHeight();

      pdf.addImage(imgData, "PNG", 0, position, pdfWidth, pdfHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 0) {
        position = heightLeft - pdfHeight;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, position, pdfWidth, pdfHeight);
        heightLeft -= pageHeight;
      }

      pdf.save(`CV_${cv?.name?.replace(/\s+/g, "_") || "document"}.pdf`);
      toast.success("PDF downloaded successfully");
    } catch (err) {
      console.error("PDF export error:", err);
      try {
        const res = await apiClient.get(`cv/${slug}/export/pdf`, { responseType: "blob" });
        const url = window.URL.createObjectURL(new Blob([res.data]));
        const link = document.createElement("a");
        link.href = url;
        link.setAttribute("download", `CV_${cv?.name?.replace(/\s+/g, "_") || "document"}.pdf`);
        document.body.appendChild(link);
        link.click();
        link.remove();
        toast.success("PDF downloaded successfully (server-side)");
      } catch {
        toast.error("Failed to export PDF");
      }
    } finally {
      setExportingPdf(false);
    }
  };

  const handleExportWord = async () => {
    setExportingWord(true);
    try {
      const res = await apiClient.get(`cv/${slug}/export/word`, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `CV_${cv?.slug || cv?.name?.replace(/\s+/g, "_") || "document"}.docx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success("Word file downloaded");
    } catch (err: any) {
      const msg = err?.response?.data?.detail || "Failed to export Word. Ensure python-docx is installed on the backend.";
      toast.error(msg);
    } finally {
      setExportingWord(false);
    }
  };

  const handlePrint = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow || !cvRef.current) return;
    const html = `
      <html>
        <head>
          <title>CV - ${cv?.name || ""}</title>
          <style>
            @page { size: A4; margin: 15mm; }
            body { font-family: 'Times New Roman', serif; font-size: 12pt; color: #000; line-height: 1.5; }
            .cv-title { text-align: center; font-size: 20pt; font-weight: bold; margin-bottom: 16px; }
            .cv-header { text-align: right; margin-bottom: 12px; }
            .cv-header .name { font-size: 14pt; font-weight: bold; }
            .section-title { font-weight: bold; font-size: 13pt; text-decoration: underline; margin-top: 12px; margin-bottom: 6px; }
            .info-row { margin-bottom: 2px; }
            .info-label { font-weight: bold; }
            table.info { width: 100%; border-collapse: collapse; }
            table.info td { padding: 2px 4px; vertical-align: top; }
            .edu-table { width: 100%; border-collapse: collapse; margin: 6px 0; }
            .edu-table td { border: 1px solid #000; padding: 3px 6px; font-size: 11pt; }
            .edu-table th { border: 1px solid #000; padding: 3px 6px; font-size: 11pt; font-weight: bold; text-align: center; background: #f0f0f0; }
            ul { margin: 2px 0; padding-left: 20px; }
            .declaration { margin-top: 12px; }
            .signature-line { margin-top: 16px; }
          </style>
        </head>
        <body>${cvRef.current.innerHTML}</body>
      </html>
    `;
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 500);
  };

  if (!authLoading && !hasPermission("cv.view")) return <AccessDenied />;

  const formatDate = (d: string | undefined) => {
    if (!d) return "";
    const dt = new Date(d);
    return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 dark:bg-slate-900 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  if (!cv) return null;

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-slate-900 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <button onClick={() => router.push("/cv")} className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors">
            <ChevronLeft className="w-4 h-4" /> Back to CV List
          </button>
          <div className="flex items-center gap-2">
            {hasPermission("cv.export") && (
              <>
                <button onClick={handleExportPDF} disabled={exportingPdf} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50 transition-colors">
                  {exportingPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  PDF
                </button>
                <button onClick={handleExportWord} disabled={exportingWord} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors">
                  {exportingWord ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
                  Word
                </button>
                <button onClick={handlePrint} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors">
                  <Printer className="w-3.5 h-3.5" /> Print
                </button>
              </>
            )}
            {hasPermission("cv.edit") && (
              <button onClick={() => router.push(`/cv/${cv.slug}/edit`)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors">
                <FileText className="w-3.5 h-3.5" /> Edit
              </button>
            )}
          </div>
        </div>

        {/* CV Template - Exact DOCX Design */}
        <div
          ref={cvRef}
          className="bg-white text-black shadow-lg mx-auto"
          style={{
            fontFamily: "'Times New Roman', 'Aptos Narrow', 'Calibri', serif",
            fontSize: "12pt",
            lineHeight: "1.3",
            padding: "25.4mm 25.4mm",
            maxWidth: "210mm",
          }}
        >
          {/* Title */}
          <div style={{ textAlign: "center", fontSize: "20pt", fontWeight: "bold", marginBottom: "10pt", letterSpacing: "2pt" }}>
            CURRICULUM VITAE
          </div>

          {/* Header - left=name/care_of/mobile, right=photo */}
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              <tr>
                <td style={{ verticalAlign: "top", fontSize: "11pt", padding: 0 }}>
                  <div style={{ fontWeight: "bold", fontSize: "14pt", marginBottom: "2pt" }}>{cv.name?.toUpperCase()}</div>
                  {cv.care_of && <div>C/O: {cv.care_of?.toUpperCase()}</div>}
                  {cv.mobile && <div>Mobile: {cv.mobile}</div>}
                </td>
                <td style={{ width: "110px", verticalAlign: "top", textAlign: "right", padding: 0 }}>
                  {cv.photo_url && (
                    <img
                      src={resolveImageUrl(cv.photo_url) || ""}
                      alt="Photo"
                      style={{ width: "100px", height: "120px", objectFit: "cover", border: "1px solid #ccc" }}
                    />
                  )}
                </td>
              </tr>
            </tbody>
          </table>

          <div style={{ height: "6pt" }} />

          {/* Personal Information */}
          <SectionTitle text="PERSONAL INFORMATION" />
          {cv.name && <InfoLine label="Name" value={cv.name} />}
          {cv.fathers_name && <InfoLine label="Father's Name" value={cv.fathers_name} />}
          {cv.mothers_name && <InfoLine label="Mother's Name" value={cv.mothers_name} />}
          {cv.permanent_address && <InfoLine label="Permanent Address" value={cv.permanent_address} />}
          {cv.date_of_birth && <InfoLine label="Date of Birth" value={formatDate(cv.date_of_birth)} />}
          {cv.nid_number && <InfoLine label="NID Number" value={cv.nid_number} />}
          {cv.nationality && <InfoLine label="Nationality" value={cv.nationality} />}
          {cv.religion && <InfoLine label="Religion" value={cv.religion} />}
          {cv.marital_status && <InfoLine label="Marital Status" value={cv.marital_status} />}
          {cv.blood_group && <InfoLine label="Blood Group" value={cv.blood_group} />}

          {/* Educational Qualification */}
          {cv.educational_qualifications && cv.educational_qualifications.length > 0 && (
            <>
              <div style={{ height: "6pt" }} />
              <SectionTitle text="EDUCATIONAL QUALIFICATION" />
              {cv.educational_qualifications.map((edu, i) => (
                <div key={i} style={{ marginBottom: "3pt" }}>
                  <div style={{ fontWeight: "bold" }}>{edu.degree}{edu.group_subject ? ` (${edu.group_subject})` : ""}</div>
                  <div>Board: {edu.board} | Result: {edu.result}</div>
                  <div>Institution: {edu.institution}</div>
                  <div>Passing Year: {edu.passing_year}</div>
                  {i < cv.educational_qualifications.length - 1 && <div style={{ height: "2pt" }} />}
                </div>
              ))}
            </>
          )}

          {/* Professional Experience */}
          {cv.professional_experiences && cv.professional_experiences.length > 0 && (
            <>
              <div style={{ height: "6pt" }} />
              <SectionTitle text="PROFESSIONAL EXPERIENCE" />
              {cv.professional_experiences.map((exp, i) => (
                <div key={i} style={{ marginBottom: "3pt" }}>
                  <div><span style={{ fontWeight: "bold" }}>Institution:</span> {exp.institution}</div>
                  <div><span style={{ fontWeight: "bold" }}>Designation:</span> {exp.designation}</div>
                  <div><span style={{ fontWeight: "bold" }}>Duration:</span> {exp.duration}</div>
                  {exp.responsibilities && exp.responsibilities.length > 0 && (
                    <div>
                      <div style={{ fontWeight: "bold" }}>Responsibilities:</div>
                      {exp.responsibilities.map((resp, ri) => (
                        <div key={ri} style={{ paddingLeft: "14pt", fontStyle: "italic" }}>— {resp}</div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}

          {/* Language Proficiency */}
          {cv.language_proficiency && (
            <>
              <div style={{ height: "6pt" }} />
              <SectionTitle text="LANGUAGE PROFICIENCY" />
              <div>{cv.language_proficiency}</div>
            </>
          )}

          {/* Declaration */}
          <div style={{ height: "6pt" }} />
          <SectionTitle text="DECLARATION" />
          <div>{cv.declaration_text || "I, the undersigned, certify that all information stated herein is true and correct."}</div>

          {/* Signature Block */}
          <div style={{ height: "14pt" }} />
          {cv.signature_url && (
            <div style={{ marginBottom: "2pt", marginLeft: "100pt" }}>
              <img src={resolveImageUrl(cv.signature_url) || ""} alt="Signature" style={{ height: "32px", objectFit: "contain" }} />
            </div>
          )}
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              <tr>
                <td style={{ width: "65pt", verticalAlign: "bottom", padding: 0 }}>
                  <span style={{ fontWeight: "bold", fontSize: "11pt" }}>Signature:</span>
                </td>
                <td style={{ verticalAlign: "bottom", padding: "0 8pt" }}>
                  <div style={{ borderBottom: "1px solid #000", height: "1pt", width: "100%", marginTop: "2pt" }} />
                </td>
                <td style={{ width: "120pt", verticalAlign: "bottom", padding: "0 0 0 6pt" }}>
                  <span style={{ fontWeight: "bold", fontSize: "11pt" }}>{cv.signature_name || ""}</span>
                </td>
                <td style={{ width: "40pt", textAlign: "right", verticalAlign: "bottom", padding: 0 }}>
                  <span style={{ fontWeight: "bold", fontSize: "11pt" }}>Date:</span>
                </td>
                <td style={{ width: "80pt", verticalAlign: "bottom", padding: "0 0 0 4pt" }}>
                  <div style={{ borderBottom: "1px solid #000", height: "1pt", width: "100%", marginTop: "2pt" }} />
                </td>
                <td style={{ width: "10pt", padding: 0 }} />
                <td style={{ whiteSpace: "nowrap", verticalAlign: "bottom", padding: "0 0 0 2pt" }}>
                  {cv.declaration_date ? formatDate(cv.declaration_date) : ""}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ text }: { text: string }) {
  return (
    <div
      style={{
        fontWeight: "bold",
        fontSize: "12pt",
        fontFamily: "'Times New Roman', 'Aptos Narrow', 'Calibri', serif",
        borderBottom: "1px solid #000",
        paddingBottom: "1pt",
        marginTop: "0",
        marginBottom: "3pt",
        textTransform: "uppercase" as const,
      }}
    >
      {text}
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ fontSize: "11pt", fontFamily: "'Times New Roman', 'Aptos Narrow', 'Calibri', serif" }}>
      <span style={{ fontWeight: "bold" }}>{label}:</span> {value}
    </div>
  );
}
