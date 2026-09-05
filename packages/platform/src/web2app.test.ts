import { afterEach, describe, expect, it, vi } from "vitest";
import { Web2AppFileSystem } from "./web2app";

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;

afterEach(() => {
  Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true });
  globalThis.fetch = originalFetch;
});

describe("Web2AppFileSystem", () => {
  it("does not request a range when the cursor is already at EOF", async () => {
    const invoke = vi.fn(async (method: string) => method === "fs.openRead" ? { id: "grant", url: "native://file", size: 10 } : {});
    Object.defineProperty(globalThis, "window", { value: { lw: { invoke, on: vi.fn(), off: vi.fn() } }, configurable: true });
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    const result = await new Web2AppFileSystem().readRange("/fixture.jsonl", 10);
    expect(result.byteLength).toBe(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("file.revoke", { id: "grant" });
  });

  it("surfaces a range error instead of falling back to a full-file read", async () => {
    const invoke = vi.fn(async (method: string) => method === "fs.openRead" ? { id: "grant", url: "native://file", size: 10 } : {});
    Object.defineProperty(globalThis, "window", { value: { lw: { invoke, on: vi.fn(), off: vi.fn() } }, configurable: true });
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 416 })) as unknown as typeof fetch;
    await expect(new Web2AppFileSystem().readRange("/fixture.jsonl", 5)).rejects.toThrow("416");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
