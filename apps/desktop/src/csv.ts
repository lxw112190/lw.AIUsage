import { estimatedCostUsd, pricingForModel, totalTokens, type UsageRecord } from "@lw-aiusage/core";

const csvCell = (value: string | number): string => {
  const text = String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

export function usageRecordsToCsv(
  records: readonly UsageRecord[],
  projectName: (key: string) => string,
): string {
  const rows: Array<Array<string | number>> = [[
    "time",
    "agent",
    "session_id",
    "model",
    "project",
    "input_tokens",
    "cached_input_tokens",
    "cache_creation_input_tokens",
    "output_tokens",
    "reasoning_output_tokens",
    "total_tokens",
    "estimated_cost_usd",
  ]];
  for (const record of records) {
    rows.push([
      new Date(record.timestamp).toISOString(),
      record.source,
      record.sessionId ?? "",
      record.model,
      projectName(record.projectKey),
      record.usage.inputTokens,
      record.usage.cachedInputTokens,
      record.usage.cacheCreationInputTokens,
      record.usage.outputTokens,
      record.usage.reasoningOutputTokens,
      totalTokens(record.usage),
      pricingForModel(record.model) ? estimatedCostUsd(record.usage, pricingForModel(record.model)!) : 0,
    ]);
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
