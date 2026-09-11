import type { LocationQuery, LocationQueryRaw } from "vue-router";
import type { AgentSource } from "@lw-aiusage/core";

export type UsageDatePreset = "today" | "yesterday" | "thisWeek" | "last7" | "last30" | "thisMonth" | "lastMonth" | "all" | "custom";
export interface ResolvedUsageRoute {
  preset: UsageDatePreset;
  from?: number;
  to?: number;
  fromDate: string;
  toDate: string;
  source?: AgentSource;
  model?: string;
  projectKey?: string;
  sessionId?: string;
  page: number;
  pageSize: number;
  sort?: string;
}

const scalar = (value: LocationQuery[string] | undefined): string | undefined => {
  const result = Array.isArray(value) ? value[0] : value;
  return typeof result === "string" && result ? result : undefined;
};
const dateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const parseDate = (value?: string): number | undefined => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date.getTime();
};
const endOfDate = (value: number): number => {
  const date = new Date(value);
  date.setDate(date.getDate() + 1);
  return date.getTime();
};
const addDays = (value: number, amount: number): number => {
  const date = new Date(value);
  date.setDate(date.getDate() + amount);
  return date.getTime();
};
const startOfToday = (now: number): number => {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};
const startOfLocalWeek = (timestamp: number): number => {
  const date = new Date(timestamp);
  const day = date.getDay();
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - (day === 0 ? 6 : day - 1)).getTime();
};
const validPreset = (value?: string): UsageDatePreset =>
  value === "today" || value === "yesterday" || value === "thisWeek" || value === "last7" || value === "last30" || value === "thisMonth" || value === "lastMonth" || value === "custom" ? value : "all";
const positiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export function localDateKey(timestamp: number): string { return dateKey(new Date(timestamp)); }

export function parseUsageRouteQuery(query: LocationQuery, now = Date.now()): ResolvedUsageRoute {
  const rawPreset = scalar(query.preset);
  const preset = rawPreset ? validPreset(rawPreset) : (scalar(query.from) || scalar(query.to) ? "custom" : "all");
  const today = startOfToday(now);
  let from = parseDate(scalar(query.from));
  let toDate = scalar(query.to) ?? "";
  if (preset === "today") { from = today; toDate = dateKey(new Date(today)); }
  if (preset === "yesterday") { from = addDays(today, -1); toDate = dateKey(new Date(from)); }
  if (preset === "thisWeek") { from = startOfLocalWeek(today); toDate = dateKey(new Date(today)); }
  if (preset === "last7") { from = addDays(today, -6); toDate = dateKey(new Date(today)); }
  if (preset === "last30") { from = addDays(today, -29); toDate = dateKey(new Date(today)); }
  if (preset === "thisMonth") {
    const date = new Date(today);
    from = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
    toDate = dateKey(new Date(today));
  }
  if (preset === "lastMonth") {
    const date = new Date(today);
    from = new Date(date.getFullYear(), date.getMonth() - 1, 1).getTime();
    toDate = dateKey(new Date(new Date(date.getFullYear(), date.getMonth(), 0).getTime()));
  }
  const parsedTo = parseDate(toDate);
  if (preset === "all") { from = undefined; toDate = ""; }
  if (preset === "custom" && (from === undefined || parsedTo === undefined || from > parsedTo)) { from = undefined; toDate = ""; }
  return {
    preset,
    from,
    to: parsedTo === undefined || !toDate ? undefined : endOfDate(parsedTo),
    fromDate: from === undefined ? "" : dateKey(new Date(from)),
    toDate: from === undefined ? "" : toDate,
    source: scalar(query.source) === "codex" || scalar(query.source) === "claude" ? scalar(query.source) as AgentSource : undefined,
    model: scalar(query.model),
    projectKey: scalar(query.project),
    sessionId: scalar(query.session),
    page: positiveInt(scalar(query.page), 1),
    pageSize: [20, 30, 50, 100].includes(positiveInt(scalar(query.pageSize), 50)) ? positiveInt(scalar(query.pageSize), 50) : 50,
    sort: scalar(query.sort),
  };
}

export function buildUsageRouteQuery(filters: Partial<ResolvedUsageRoute>): LocationQueryRaw {
  const query: LocationQueryRaw = {};
  if (filters.preset && filters.preset !== "all") query.preset = filters.preset;
  if (filters.fromDate) query.from = filters.fromDate;
  if (filters.toDate) query.to = filters.toDate;
  if (filters.source) query.source = filters.source;
  if (filters.model) query.model = filters.model;
  if (filters.projectKey) query.project = filters.projectKey;
  if (filters.sessionId) query.session = filters.sessionId;
  if (filters.page && filters.page > 1) query.page = String(filters.page);
  if (filters.pageSize && filters.pageSize !== 50) query.pageSize = String(filters.pageSize);
  if (filters.sort) query.sort = filters.sort;
  return query;
}
