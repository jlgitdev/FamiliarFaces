const PERSON_FIELDS = ["name", "relationship", "bio", "recentTopics"] as const;

type PersonField = (typeof PERSON_FIELDS)[number];
export type PersonPayload = Record<PersonField, string>;

function readTextField(body: Record<string, unknown>, field: PersonField) {
  const value = body[field];
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function readPersonPayload(body: unknown): PersonPayload | null {
  if (!isRecord(body)) return null;

  const data = {
    name: readTextField(body, "name"),
    relationship: readTextField(body, "relationship"),
    bio: readTextField(body, "bio"),
    recentTopics: readTextField(body, "recentTopics"),
  };

  return PERSON_FIELDS.every((field) => data[field]) ? data : null;
}

export function readPersonUpdate(body: unknown): Partial<PersonPayload> {
  if (!isRecord(body)) return {};

  return PERSON_FIELDS.reduce<Partial<PersonPayload>>((data, field) => {
    const value = readTextField(body, field);
    if (value) data[field] = value;
    return data;
  }, {});
}
