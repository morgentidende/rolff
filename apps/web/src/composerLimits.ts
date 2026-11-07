// Product quotas count Unicode code points, not encoded SMS segments or UTF-16 units.
export const messageCharCount = (text: string) => [...text].length;
export const planCharLimit = (plan: string | null) => plan === "text_attachments" ? 480 : 160;
export const effectiveCharLimit = (plan: string | null, _legacyRecipientLimit?: number | null) => planCharLimit(plan);

// A saved key exists only once this exact draft has been submitted. Retrying it
// is safe after a downgrade: the server either returns its existing acceptance
// or applies the current quota before any new moderation/send.
export function textRetryKey(serialized: string | null, text: string, reply: string | null): string | null {
  try {
    const saved = JSON.parse(serialized || "null");
    return saved && saved.text === text && (saved.reply ?? null) === reply &&
      typeof saved.key === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(saved.key) ? saved.key : null;
  } catch { return null; }
}
