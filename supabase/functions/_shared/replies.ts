// PostgreSQL canonicalizes UUIDs before storing the opaque retry fingerprint.
export const normalizeReplyId = (value: unknown): string | null => value == null ? null : String(value).toLowerCase();
