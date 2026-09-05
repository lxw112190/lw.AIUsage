export function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Prefer protocol IDs; otherwise derive a deterministic key from stable event data. */
export function stableEventId(
  source: string,
  sourceId: string,
  event: unknown,
  stableParts: unknown,
): string {
  const object = asObject(event);
  const candidates = [
    "uuid",
    "id",
    "event_id",
    "eventId",
    "response_id",
    "responseId",
    "turn_id",
    "turnId",
    "item_id",
    "itemId",
    "request_id",
    "requestId",
  ];
  const explicitId = candidates
    .map((key) => asString(object?.[key]))
    .find(Boolean);
  if (explicitId) return `${source}:${explicitId}`;
  return `${source}:h${stableHash(`${sourceId}\n${JSON.stringify(stableParts)}`)}`;
}

export function stringValue(value: unknown): string | undefined {
  return asString(value);
}
export function objectValue(
  value: unknown,
): Record<string, unknown> | undefined {
  return asObject(value);
}
