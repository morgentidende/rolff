import { assert, assertStringIncludes } from "jsr:@std/assert@1";

const page = await Deno.readTextFile("apps/web/public/slet-konto.html");
const policy = await Deno.readTextFile("apps/web/public/privatliv.html");

Deno.test("slet-konto.html is bilingual, names Rolff, and offers in-app + email deletion without reinstalling", () => {
  assertStringIncludes(page, "<title>Slet din Rolff-konto / Delete your Rolff account</title>");
  assertStringIncludes(page, "Slet din Rolff-konto");
  assertStringIncludes(page, "Delete your Rolff account");
  assertStringIncludes(page, "⋮");
  assertStringIncludes(page, "Konto");
  assertStringIncludes(page, "Account");
  assertStringIncludes(page, "Slet konto, slet alle data og opsig abonnement");
  assertStringIncludes(page, "Delete account, delete all data and cancel subscription");
  assertStringIncludes(page, "slettes med det samme");
  assertStringIncludes(page, "deleted immediately");
  assertStringIncludes(page, "resterende periode");
  assertStringIncludes(page, "remaining paid period is lost");
  assertStringIncludes(page, "Opsig abonnement");
  assertStringIncludes(page, "Cancel subscription");
  assertStringIncludes(page, "Rolff kan ikke betale beløbet tilbage");
  assertStringIncludes(page, "Rolff cannot refund the amount");
  assertStringIncludes(page, "ikke kun en deaktivering");
  assertStringIncludes(page, "not a mere deactivation");
  assertStringIncludes(page, "mailto:nicolaipetersen108@gmail.com");
  assertStringIncludes(page, "Du behøver ikke at installere Rolff igen");
  assertStringIncludes(page, "You do not need to reinstall Rolff");
  assertStringIncludes(page, "senest inden for 30 dage");
  assertStringIncludes(page, "within 30 days");
  assertStringIncludes(page, "Slettet bruger");
  assertStringIncludes(page, "Deleted user");
  assertStringIncludes(page, "https://apps.apple.com/account/subscriptions/");
  assertStringIncludes(page, "https://play.google.com/store/account/subscriptions");
  assertStringIncludes(page, "privatliv.html");
  assert(!/supabase_access_token|SERVICE_ROLE|sk-[a-zA-Z0-9]/.test(page));
});

Deno.test("privatliv.html points to the public deletion page and states retention on account deletion", () => {
  assertStringIncludes(policy, 'href="./slet-konto.html"');
  assertStringIncludes(policy, "slet-konto.html#en");
  assertStringIncludes(policy, "Sidst opdateret: 26. november 2026.");
  assertStringIncludes(policy, "Modpartens kopi af det, du har sendt, beholdes");
  assertStringIncludes(policy, "The other party’s copy of what you sent is kept");
});
