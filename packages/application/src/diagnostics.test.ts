import { describe, expect, it } from "vitest";
import { DiagnosticsService } from "./diagnostics";

describe("DiagnosticsService", () => {
  it("keeps a bounded, redacted export", () => {
    const diagnostics = new DiagnosticsService(2);
    diagnostics.add("INFO", "scan started C:\\Users\\Alice\\secret-project"); diagnostics.add("WARN", "bad line"); diagnostics.add("ERROR", "failed");
    expect(diagnostics.list()).toHaveLength(2); expect(diagnostics.exportJson()).not.toContain("secret-project");
  });
});
