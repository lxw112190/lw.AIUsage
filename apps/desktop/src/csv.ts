import { totalTokens, type UsageRecord } from "@lw-aiusage/core";

const csvCell = (value: string | number): string => {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export function usageRecordsToCsv(
  records: readonly UsageRecord[],
  projectName: (key: string) => string,
): string {
  const rows: Array<Array<string | number>> = [[
    "time",
    "agent",
    "model",
    "project",
    "input_tokens",
    "cached_input_tokens",
    "cache_creation_input_tokens",
    "output_tokens",
    "reasoning_output_tokens",
    "total_tokens",
  ]];
  for (const record of records) {
    rows.push([
      new Date(record.timestamp).toISOString(),
      record.source,
      record.model,
      projectName(record.projectKey),
      record.usage.inputTokens,
      record.usage.cachedInputTokens,
      record.usage.cacheCreationInputTokens,
      record.usage.outputTokens,
      record.usage.reasoningOutputTokens,
      totalTokens(record.usage),
    ]);
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
