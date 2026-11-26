// Account deletion (art. 17). Optional pre-delete transcript is sent first; deletion is aborted if
// that mail cannot be queued. Logs never contain content or addresses.
import { mailLang, type MailLang } from "./email.ts";

export type DeleteAccountInput = { password?: unknown; email_transcript?: unknown; lang?: unknown };
export type DeleteAccountDeps = {
  getEmail: () => Promise<string | null>;
  checkPassword: (email: string, password: string) => Promise<boolean>;
  sendTranscript: (email: string, lang: MailLang) => Promise<boolean>;
  purge: () => Promise<boolean>;
  deleteAuth: () => Promise<boolean>;
};

export async function runDeleteAccount(
  input: DeleteAccountInput,
  deps: DeleteAccountDeps,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const password = String(input?.password ?? "");
  if (!password) return { status: 400, body: { error: "password_required" } };
  const email = await deps.getEmail();
  if (!email) return { status: 401, body: { error: "unauthenticated" } };
  if (!await deps.checkPassword(email, password)) return { status: 403, body: { error: "wrong_password" } };
  const wantTranscript = input.email_transcript === true;
  const lang = mailLang(input.lang);
  if (wantTranscript) {
    const sent = await deps.sendTranscript(email, lang);
    if (!sent) return { status: 502, body: { error: "export_failed" } };
  }
  if (!await deps.purge()) return { status: 500, body: { error: "delete_failed" } };
  if (!await deps.deleteAuth()) return { status: 500, body: { error: "delete_failed" } };
  return { status: 200, body: { data: { deleted: true, transcript_sent: wantTranscript } } };
}
