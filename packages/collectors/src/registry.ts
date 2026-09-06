import { CodexCollectorV5 } from "./codex/collectorV5";
import { ClaudeCollector } from "./claude/collector";
import type { Collector } from "./types";
export const defaultCollectors = (): Collector[] => [
  new CodexCollectorV5(),
  new ClaudeCollector(),
];
