export interface EducationalQualification {
  degree: string;
  group_subject: string;
  board: string;
  result: string;
  institution: string;
  passing_year: number;
}

export interface ProfessionalExperience {
  institution: string;
  designation: string;
  duration: string;
  responsibilities: string[];
}

export interface CV {
  id: number;
  slug: string;
  user_id: number;
  house_id?: number;
  name: string;
  care_of?: string;
  mobile?: string;
  fathers_name?: string;
  mothers_name?: string;
  permanent_address?: string;
  date_of_birth?: string;
  nid_number?: string;
  nationality?: string;
  religion?: string;
  marital_status?: string;
  blood_group?: string;
  educational_qualifications: EducationalQualification[];
  professional_experiences: ProfessionalExperience[];
  language_proficiency?: string;
  photo_url?: string;
  signature_url?: string;
  declaration_text?: string;
  signature_name?: string;
  declaration_date?: string;
  created_at?: string;
  updated_at?: string;
}

export interface CVFormData {
  name: string;
  care_of: string;
  mobile: string;
  fathers_name: string;
  mothers_name: string;
  permanent_address: string;
  date_of_birth: string;
  nid_number: string;
  nationality: string;
  religion: string;
  marital_status: string;
  blood_group: string;
  educational_qualifications: EducationalQualification[];
  professional_experiences: ProfessionalExperience[];
  language_proficiency: string;
  declaration_text: string;
  photo_url: string;
  signature_url: string;
  signature_name: string;
  declaration_date: string;
}
