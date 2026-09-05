import { describe, expect, it } from "vitest";
import { formatTokenAmount, formatTokenDetail } from "./format";

describe("token amount formatting", () => {
  it("uses Chinese units for large values", () => {
    expect(formatTokenAmount(37_741, { locale: "zh" })).toBe("3.77万");
    expect(formatTokenAmount(97_760_000, { locale: "zh" })).toBe("9776万");
    expect(formatTokenAmount(4_774_190_000, { locale: "zh" })).toBe("47.74亿");
  });

  it("uses English units when English is selected", () => {
    expect(formatTokenAmount(4_892_845_270, { locale: "en" })).toBe("4.89B");
  });

  it("can show a compact value and its raw Token value together", () => {
    const detail = formatTokenDetail(12_345, "zh");
    expect(detail).toContain("1.23万");
    expect(detail).toContain("12,345 Token");
  });
});
