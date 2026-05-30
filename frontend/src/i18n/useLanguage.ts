import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Language, translations } from './translations';

interface LanguageState {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (path: string, params?: Record<string, string | number | undefined>) => string;
}

export const useLanguage = create<LanguageState>()(
  persist(
    (set, get) => ({
      language: 'en',
      setLanguage: (lang: Language) => set({ language: lang }),
      t: (path: string, params?: Record<string, string | number | undefined>) => {
        const { language } = get();
        const keys = path.split('.');
        let result: any = translations[language];
        
        for (const key of keys) {
          if (result && result[key]) {
            result = result[key];
          } else {
            // Fallback to English if key not found in current language
            let fallback: any = translations['en'];
            for (const fKey of keys) {
              if (fallback && fallback[fKey]) {
                fallback = fallback[fKey];
              } else {
                return path; // Return path if not found in fallback either
              }
            }
            return fallback;
          }
        }
        
        let value = typeof result === 'string' ? result : path;
        if (params) {
          for (const [key, val] of Object.entries(params)) {
            value = value.replace(new RegExp(`\\{${key}\\}`, 'g'), val != null ? String(val) : '');
          }
        }
        return value;
      },
    }),
    {
      name: 'language-storage',
    }
  )
);
