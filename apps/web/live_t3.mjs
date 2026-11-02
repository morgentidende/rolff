import { createClient } from "@supabase/supabase-js"; import fs from "node:fs";
const U = "https://dubwlbqazbllnwpsqrjv.supabase.co", sk = fs.readFileSync("/tmp/sk","utf8").trim(), pk = fs.readFileSync("/tmp/pk","utf8").trim();
const admin = createClient(U, sk, { auth: { persistSession: false } }); const uid = fs.readFileSync("/tmp/rolff_live_uid","utf8").trim();
const cur = (await admin.auth.admin.getUserById(uid)).data.user.email, nx = cur.replace("+ra", "+rn");
const g = await admin.auth.admin.generateLink({ type: "email_change_current", email: cur, newEmail: nx });
console.log(g.data.properties.hashed_token, g.data.properties.email_otp, g.data.properties.verification_type); process.exit(0);
const v = await c.auth.verifyOtp({ token_hash: g.data.properties.hashed_token, type: "email_change" });
console.log(v.error?.message ?? "verify ok", (await admin.auth.admin.getUserById(uid)).data.user.email.includes("+rn") ? "CHANGED" : "unchanged");
