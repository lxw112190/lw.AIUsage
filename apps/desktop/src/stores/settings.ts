import { ref, watch } from "vue";
import { defineStore } from "pinia";

export type ThemeMode = "system" | "light" | "dark";
export type Language = "zh" | "en";
const storageKey = "lw-aiusage.theme";
const languageStorageKey = "lw-aiusage.language";
const initialTheme = (): ThemeMode => {
  const saved = localStorage.getItem(storageKey);
  return saved === "light" || saved === "dark" || saved === "system"
    ? saved
    : "system";
};
const initialLanguage = (): Language => {
  const saved = localStorage.getItem(languageStorageKey);
  if (saved === "zh" || saved === "en") return saved;
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
};
export const useSettingsStore = defineStore("settings", () => {
  const theme = ref<ThemeMode>(initialTheme());
  const language = ref<Language>(initialLanguage());
  function applyTheme(value: ThemeMode): void {
    const effective =
      value === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : value;
    document.documentElement.dataset.theme = effective;
    document.documentElement.dataset.themeMode = value;
    localStorage.setItem(storageKey, value);
  }
  function setTheme(value: ThemeMode): void {
    theme.value = value;
    applyTheme(value);
  }
  function setLanguage(value: Language): void {
    language.value = value;
    document.documentElement.lang = value === "zh" ? "zh-CN" : "en-US";
    localStorage.setItem(languageStorageKey, value);
  }
  applyTheme(theme.value);
  setLanguage(language.value);
  watch(theme, (value) => applyTheme(value));
  watch(language, (value) => setLanguage(value));
  return { theme, language, setTheme, setLanguage };
});
