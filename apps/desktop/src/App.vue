<script setup lang="ts">
import { computed, onMounted } from "vue";
import { RouterLink, RouterView } from "vue-router";
import { useUsageStore } from "./stores/usage";
import { useSettingsStore } from "./stores/settings";
import { useI18n } from "./i18n";
const store = useUsageStore();
const settings = useSettingsStore();
const { t } = useI18n();
const syncLabel = computed(() => store.syncing
  ? (store.syncReason === "startup" ? t("header.checking") : t("header.syncing"))
  : t("header.syncNow"));
function changeLanguage(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  settings.setLanguage(value === "zh" ? "zh" : "en");
}
onMounted(() => {
  void store.bootstrap();
});
</script>
<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-mark">✦</span><span>lw.AIUsage</span>
      </div>
      <nav>
        <RouterLink to="/">{{ t("nav.overview") }}</RouterLink
        ><RouterLink to="/usage">{{ t("nav.usage") }}</RouterLink
        ><RouterLink to="/sessions">{{ t("nav.sessions") }}</RouterLink
        ><RouterLink to="/stats">{{ t("nav.stats") }}</RouterLink
        ><RouterLink to="/agents">{{ t("nav.agents") }}</RouterLink
        ><RouterLink to="/settings">{{ t("nav.settings") }}</RouterLink>
      </nav>
      <div class="privacy-note">
        <span class="status-dot"></span
        ><span
          >{{ t("privacy.localOnly") }}<br /><small>{{
            t("privacy.noPrompt")
          }}</small></span
        >
      </div>
    </aside>
    <main class="main">
      <header class="topbar">
        <div>
          <p class="eyebrow">{{ t("header.eyebrow") }}</p>
          <h1>{{ t("header.title") }}</h1>
        </div>
        <div class="topbar-actions">
          <select
            class="language-select"
            :value="settings.language"
            aria-label="Language"
            @change="changeLanguage"
          >
            <option value="zh">中文</option>
            <option value="en">English</option></select
          ><button
            class="sync-button"
            :disabled="store.syncing"
            @click="store.sync"
          >
            {{ syncLabel }}
            <span>↻</span>
          </button>
        </div>
      </header>
      <div v-if="store.error" class="error-banner">{{ store.error }}</div>
      <RouterView />
    </main>
  </div>
</template>
