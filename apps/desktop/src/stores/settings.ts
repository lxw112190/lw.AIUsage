import { ref, watch } from "vue";
import { defineStore } from "pinia";
import type { ActivityGranularity } from "@lw-aiusage/application";

export type ThemeMode = "system" | "light" | "dark";
export type Language = "zh" | "en";
const storageKey = "lw-aiusage.theme";
const languageStorageKey = "lw-aiusage.language";
const activityStorageKey = "lw-aiusage.activity-granularity";
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
const initialActivity = (): ActivityGranularity => {
  const saved = localStorage.getItem(activityStorageKey);
  return saved === "daily" || saved === "weekly" || saved === "monthly" || saved === "cumulative" ? saved : "daily";
};
export const useSettingsStore = defineStore("settings", () => {
  const theme = ref<ThemeMode>(initialTheme());
  const language = ref<Language>(initialLanguage());
  const activityGranularity = ref<ActivityGranularity>(initialActivity());
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
  function setActivityGranularity(value: ActivityGranularity): void {
    activityGranularity.value = value;
    localStorage.setItem(activityStorageKey, value);
  }
  applyTheme(theme.value);
  setLanguage(language.value);
  setActivityGranularity(activityGranularity.value);
  watch(theme, (value) => applyTheme(value));
  watch(language, (value) => setLanguage(value));
  watch(activityGranularity, (value) => setActivityGranularity(value));
  return { theme, language, activityGranularity, setTheme, setLanguage, setActivityGranularity };
});
