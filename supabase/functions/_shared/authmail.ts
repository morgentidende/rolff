// Pure helpers for account-mail (testable without Supabase deps).
export const EMAIL = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;
export const allowed = (email: string, env: string, allow: string) =>
  env === "production" || (!!allow && new RegExp(allow, "i").test(email));
export const authLink = (app: string, type: string, hash: string) =>
  `${app.replace(/\/?$/, "/")}?auth=${encodeURIComponent(type)}&th=${encodeURIComponent(hash)}`;
