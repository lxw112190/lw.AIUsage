<script setup lang="ts">
import { ref } from "vue";
import { useSettingsStore, type ThemeMode } from "../stores/settings";
import { useUsageStore } from "../stores/usage";
import { useI18n } from "../i18n";

const settings = useSettingsStore();
const usage = useUsageStore();
const { t } = useI18n();
const busy = ref(false);
function changeLanguage(event: Event): void { const value = (event.target as HTMLSelectElement).value; settings.setLanguage(value === "zh" ? "zh" : "en"); }
function changeTheme(event: Event): void { const value = (event.target as HTMLSelectElement).value; if (value === "system" || value === "light" || value === "dark") settings.setTheme(value as ThemeMode); }
async function rebuild(): Promise<void> { if (!window.confirm(t("confirm.rebuild"))) return; busy.value = true; try { await usage.rebuild(); } finally { busy.value = false; } }
async function resetData(): Promise<void> { if (!window.confirm(t("confirm.reset"))) return; await usage.resetLocalData(); }
</script>

<template>
  <section class="page"><div class="page-heading"><div><h2>{{ t("settings.title") }}</h2><p>{{ t("settings.description") }}</p></div></div><article class="panel settings-panel"><div class="setting-row"><div><h3>{{ t("settings.language") }}</h3><p>{{ t("settings.languageDescription") }}</p></div><select class="theme-select" :value="settings.language" @change="changeLanguage"><option value="zh">{{ t("settings.chinese") }}</option><option value="en">{{ t("settings.english") }}</option></select></div><div class="setting-row"><div><h3>{{ t("settings.theme") }}</h3><p>{{ t("settings.themeDescription") }}</p></div><select class="theme-select" :value="settings.theme" @change="changeTheme"><option value="system">{{ t("settings.system") }}</option><option value="light">{{ t("settings.light") }}</option><option value="dark">{{ t("settings.dark") }}</option></select></div><div class="setting-row"><div><h3>{{ t("settings.showCost") }}</h3><p>{{ t("settings.showCostDescription") }}</p></div><span class="toggle on">{{ t("settings.on") }}</span></div><div class="setting-row"><div><h3>{{ t("settings.collectProject") }}</h3><p>{{ t("settings.collectProjectDescription") }}</p></div><span class="toggle on">{{ t("settings.on") }}</span></div><div class="setting-row"><div><h3>{{ t("settings.rebuild") }}</h3><p>{{ t("settings.rebuildDescription") }}</p></div><button class="setting-action" :disabled="busy" @click="rebuild">{{ busy ? t("settings.rebuilding") : t("settings.rebuildAction") }}</button></div><div class="setting-row"><div><h3>{{ t("settings.diagnostics") }}</h3><p>{{ t("settings.diagnosticsDescription") }}</p></div><button class="setting-action" @click="usage.exportDiagnostics">{{ t("settings.export") }}</button></div><div class="setting-row danger-row"><div><h3>{{ t("settings.reset") }}</h3><p>{{ t("settings.resetDescription") }}</p></div><button class="danger-action" @click="resetData">{{ t("settings.resetAction") }}</button></div><div class="setting-row"><div><h3>{{ t("settings.cloudSync") }}</h3><p>{{ t("settings.cloudSyncDescription") }}</p></div><span class="privacy-chip">{{ t("settings.localOnly") }}</span></div></article></section>
</template>
