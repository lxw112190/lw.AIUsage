import { describe, expect, it } from "vitest";
import { addLocalDays, startOfLocalDay, startOfLocalWeek } from "./localDate";

describe("local calendar dates", () => {
  it("adds calendar days without depending on a fixed 24-hour duration", () => {
    const start = new Date(2026, 8, 4, 18, 30).getTime();
    const next = new Date(addLocalDays(startOfLocalDay(start), 1));
    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(8);
    expect(next.getDate()).toBe(5);
    expect(next.getHours()).toBe(0);
  });

  it("uses Monday as the start of a local week", () => {
    const monday = new Date(startOfLocalWeek(new Date(2026, 8, 7).getTime()));
    expect(monday.getDay()).toBe(1);
    expect(monday.getDate()).toBe(7);
  });
});
