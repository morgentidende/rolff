// The ONE place where links in mails and invitations are built. Default: the Rolff web app.
// Override with the APP_URL secret (e.g. a future app deep-link/universal-link domain).
export const DEFAULT_APP_URL = "https://yellowgreen-lobster-916967.hostingersite.com/";
const denoEnv = { get: (k: string) => { try { return Deno.env.get(k); } catch { return undefined; } } };
export function appUrl(env: { get(k: string): string | undefined } = denoEnv): string {
  const v = (env.get("APP_URL") ?? "").trim();
  return (/^https:\/\/[^\s#?]+$/.test(v) ? v : DEFAULT_APP_URL).replace(/\/?$/, "/");
}
export const inviteLink = (token: string, env?: { get(k: string): string | undefined }) => `${appUrl(env)}#invite=${token}`;
