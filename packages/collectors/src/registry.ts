import { CodexCollector } from "./codex/collector";
import { ClaudeCollector } from "./claude/collector";
import type { Collector } from "./types";
export const defaultCollectors = (): Collector[] => [
  new CodexCollector(),
  new ClaudeCollector(),
];
