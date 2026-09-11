<script setup lang="ts">
import { computed, ref } from "vue";
import { useStatsStore } from "../stores/stats";
import { useI18n } from "../i18n";
import { formatTokenAmount } from "../format";
import { useProjectPreferencesStore } from "../stores/projects";
import { useRouter } from "vue-router";

const store = useStatsStore();
const projects = useProjectPreferencesStore();
const { t, locale } = useI18n();
const router = useRouter();
const format = (value: number): string => formatTokenAmount(value, { locale: locale.value });
const money = (value: number): string => `$${value.toFixed(2)}`;
const showHidden = ref(false);
const editingKey = ref<string>();
const editingName = ref("");
const actionError = ref("");
const hiddenCount = computed(() => store.data.byProject.filter((item) => projects.isHidden(item.key)).length);
const visibleProjects = computed(() => store.data.byProject.filter((item) => showHidden.value || !projects.isHidden(item.key)));
void projects.load();

function startRename(key: string): void {
  actionError.value = "";
  editingKey.value = key;
  editingName.value = projects.nameFor(key);
}

function cancelRename(): void {
  editingKey.value = undefined;
  editingName.value = "";
}

async function saveRename(key: string): Promise<void> {
  actionError.value = "";
  try {
    await projects.rename(key, editingName.value);
    cancelRename();
  } catch (cause) {
    actionError.value = cause instanceof Error ? cause.message : t("stats.actionFailed");
  }
}

async function toggleProject(key: string): Promise<void> {
  actionError.value = "";
  try {
    await projects.setHidden(key, !projects.isHidden(key));
  } catch (cause) {
    actionError.value = cause instanceof Error ? cause.message : t("stats.actionFailed");
  }
}
function openModel(key: string): void { void router.push({ path: "/usage", query: { model: key } }); }
function openProject(key: string): void { void router.push({ path: "/usage", query: { project: key } }); }
</script>

<template>
  <section class="page">
    <div class="page-heading"><div><h2>{{ t("stats.title") }}</h2><p>{{ t("stats.description") }}</p></div></div>
    <div class="stats-columns">
      <article class="panel"><div class="panel-heading"><div><h2>{{ t("stats.models") }}</h2><p>{{ t("stats.modelDistribution") }}</p></div></div><div class="stats-table-wrap"><table class="compact-table"><thead><tr><th>{{ t("filter.model") }}</th><th>{{ t("stats.records") }}</th><th>{{ t("stats.tokens") }}</th><th>{{ t("stats.cost") }}</th></tr></thead><tbody><tr v-for="item in store.data.byModel" :key="item.key" class="usage-row" @click="openModel(item.key)"><td><strong>{{ item.key }}</strong></td><td>{{ item.recordCount }}</td><td>{{ format(item.totalTokens) }}</td><td>{{ money(item.estimatedCostUsd) }}</td></tr><tr v-if="!store.data.byModel.length"><td colspan="4" class="empty-cell">{{ t("stats.noModelData") }}</td></tr></tbody></table></div></article>
      <article class="panel">
        <div class="panel-heading project-panel-heading">
          <div><h2>{{ t("stats.projects") }}</h2><p>{{ t("stats.projectDistribution") }}</p><small>{{ t("stats.projectVisibilityHint") }}</small></div>
          <label class="hidden-project-toggle"><input v-model="showHidden" type="checkbox" />{{ t("stats.showHidden") }} ({{ hiddenCount }})</label>
        </div>
        <p v-if="actionError" class="inline-error">{{ actionError }}</p>
        <div class="stats-table-wrap">
          <table class="compact-table project-stats-table">
            <thead><tr><th>{{ t("filter.project") }}</th><th>{{ t("stats.records") }}</th><th>{{ t("stats.tokens") }}</th><th>{{ t("stats.cost") }}</th><th>{{ t("stats.actions") }}</th></tr></thead>
            <tbody>
              <tr v-for="item in visibleProjects" :key="item.key" :class="{ 'muted-row': projects.isHidden(item.key) }">
                <td class="project-name-cell">
                  <div v-if="editingKey === item.key" class="project-name-editor"><input v-model="editingName" autofocus @keyup.enter="saveRename(item.key)" @keyup.escape="cancelRename" /><button type="button" @click="saveRename(item.key)">{{ t("stats.save") }}</button><button type="button" @click="cancelRename">{{ t("stats.cancel") }}</button></div>
                  <strong v-else class="clickable-name" @click="openProject(item.key)">{{ projects.nameFor(item.key) }}</strong>
                </td>
                <td>{{ item.recordCount }}</td><td>{{ format(item.totalTokens) }}</td><td>{{ money(item.estimatedCostUsd) }}</td>
                <td><div class="table-actions"><button v-if="editingKey !== item.key" type="button" @click="startRename(item.key)">{{ t("stats.rename") }}</button><button type="button" @click="toggleProject(item.key)">{{ projects.isHidden(item.key) ? t("stats.restore") : t("stats.hide") }}</button></div></td>
              </tr>
              <tr v-if="!visibleProjects.length"><td colspan="5" class="empty-cell">{{ t("stats.noProjectData") }}</td></tr>
            </tbody>
          </table>
        </div>
      </article>
    </div>
  </section>
</template>
