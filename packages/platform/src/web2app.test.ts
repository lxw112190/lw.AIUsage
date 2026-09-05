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

  it("serializes concurrent native file reads", async () => {
    let active = 0;
    let maximum = 0;
    const invoke = vi.fn(async (method: string) => {
      if (method !== "fs.openRead") return {};
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return { id: `grant-${maximum}`, url: "native://file", size: 10 };
    });
    Object.defineProperty(globalThis, "window", { value: { lw: { invoke, on: vi.fn(), off: vi.fn() } }, configurable: true });
    globalThis.fetch = vi.fn(async () => new Response(new Uint8Array([1]), { status: 206 })) as unknown as typeof fetch;
    const filesystem = new Web2AppFileSystem();
    await Promise.all([
      filesystem.readRange("/fixture.jsonl", 0, 1),
      filesystem.readRange("/fixture.jsonl", 1, 2),
      filesystem.readRange("/fixture.jsonl", 2, 3),
    ]);
    expect(maximum).toBe(1);
    expect(invoke).toHaveBeenCalledWith("file.revoke", { id: "grant-1" });
  });
});
