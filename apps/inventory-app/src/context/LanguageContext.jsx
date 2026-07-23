import { createContext, useContext, useState } from 'react'
import en from '../i18n/en'
import ru from '../i18n/ru'

const strings = { en, ru }
const LanguageContext = createContext(null)

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(() => localStorage.getItem('bobacafe_lang') ?? 'en')
  const switchLang = (l) => { setLang(l); localStorage.setItem('bobacafe_lang', l) }
  const t = (key, vars = {}) => {
    let str = strings[lang]?.[key] ?? strings.en[key] ?? key
    return Object.entries(vars).reduce((s, [k, v]) => s.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v)), str)
  }
  return <LanguageContext.Provider value={{ lang, setLang: switchLang, t }}>{children}</LanguageContext.Provider>
}

export const useLanguage = () => useContext(LanguageContext)
