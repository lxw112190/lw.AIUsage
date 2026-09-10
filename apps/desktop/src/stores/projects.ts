import { ref } from "vue";
import { defineStore } from "pinia";
import { projectDisplayName, type ProjectRecord } from "@lw-aiusage/core";
import { DexieUsageRepository } from "@lw-aiusage/storage";

export const useProjectPreferencesStore = defineStore("projectPreferences", () => {
  const repository = new DexieUsageRepository();
  const records = ref<Record<string, ProjectRecord>>({});
  let loading: Promise<void> | undefined;

  async function load(): Promise<void> {
    if (loading) return loading;
    loading = repository
      .getProjects()
      .then((values) => {
        records.value = Object.fromEntries(values.map((record) => [record.key, record]));
      })
      .finally(() => {
        loading = undefined;
      });
    return loading;
  }

  function nameFor(key: string): string {
    return records.value[key]?.name.trim() || projectDisplayName(key);
  }

  function isHidden(key: string): boolean {
    return records.value[key]?.hidden === true;
  }

  async function save(key: string, changes: Partial<ProjectRecord>): Promise<void> {
    const previous = records.value[key];
    const next: ProjectRecord = {
      ...(previous ?? {
        key,
        name: projectDisplayName(key),
        lastActiveAt: Date.now(),
      }),
      ...changes,
      key,
    };
    records.value = { ...records.value, [key]: next };
    try {
      await repository.putProject(next);
    } catch (cause) {
      const restored = { ...records.value };
      if (previous) restored[key] = previous;
      else delete restored[key];
      records.value = restored;
      throw cause;
    }
  }

  async function rename(key: string, name: string): Promise<void> {
    await save(key, { name: name.trim() || projectDisplayName(key) });
  }

  async function setHidden(key: string, hidden: boolean): Promise<void> {
    await save(key, { hidden });
  }

  return { records, load, nameFor, isHidden, rename, setHidden };
});
