import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';

const resources = {
  'zh-CN': { translation: zhCN },
  en: { translation: en },
} as const;

const language = navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';

void i18n.use(initReactI18next).init({
  resources,
  lng: language,
  fallbackLng: 'zh-CN',
  interpolation: { escapeValue: false },
});

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: (typeof resources)['zh-CN'];
  }
}
