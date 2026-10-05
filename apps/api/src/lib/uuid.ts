// A well-formed UUID as Postgres understands it: 8-4-4-4-12 hex digits.
//
// Deliberately NOT zod's `.uuid()`: that is stricter in some zod versions
// (it can insist on RFC version/variant bits and so reject ids like
// 00000000-0000-0000-0000-000000000000, which Postgres accepts happily).
// The only job here is to stop a malformed id reaching Postgres, where it
// would fail the uuid cast and surface as a 500 instead of a client error.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
