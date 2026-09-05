import { describe, expect, it } from "vitest";
import { addCodexEventTaxonomy, codexEventTypeInfo, emptyCodexEventTaxonomy } from "./eventTaxonomy";

describe("Codex event taxonomy", () => {
  it("separates the event envelope from a nested token_count semantic event", () => {
    const info = codexEventTypeInfo({
      type: "event_msg",
      payload: { type: "token_count", msg: { type: "ignored" } },
    });

    expect(info).toEqual({
      outerType: "event_msg",
      payloadType: "token_count",
      messageType: "ignored",
      semanticType: "token_count",
      isTokenCount: true,
    });
  });

  it("counts every taxonomy dimension independently", () => {
    const summary = emptyCodexEventTaxonomy();
    addCodexEventTaxonomy(summary, codexEventTypeInfo({ type: "response_item", payload: { type: "message" } }));
    addCodexEventTaxonomy(summary, codexEventTypeInfo({ type: "event_msg", payload: { type: "token_count" } }));

    expect(summary.outerTypes).toEqual({ response_item: 1, event_msg: 1 });
    expect(summary.payloadTypes).toEqual({ message: 1, token_count: 1 });
    expect(summary.semanticTypes).toEqual({ response_item: 1, token_count: 1 });
    expect(summary.tokenCountEvents).toBe(1);
  });
});
