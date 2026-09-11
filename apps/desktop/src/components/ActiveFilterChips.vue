<script setup lang="ts">
import { useI18n } from "../i18n";
const { t } = useI18n();
export type FilterChipKey = "date" | "source" | "model" | "project" | "session";
export interface FilterChip { key: FilterChipKey; label: string; }
defineProps<{ items: FilterChip[] }>();
const emit = defineEmits<{ remove: [key: FilterChipKey]; clear: [] }>();
</script>
<template>
  <div v-if="items.length" class="active-filters"><span class="active-filters-label">{{ t("filter.active") }}</span><button v-for="item in items" :key="item.key" class="filter-chip" @click="emit('remove', item.key)">{{ item.label }} <span>×</span></button><button class="clear-filters-action" @click="emit('clear')">{{ t("filter.clearAll") }}</button></div>
</template>
