// Design contract of the invitation e-mail and its confirmation copy (da + en). Pure rendering, no network, no mail sent.
import { assert, assertEquals } from "jsr:@std/assert@1";
Deno.env.set("APP_URL", "https://example.test/");
const E = await import("../../supabase/functions/_shared/email.ts");
const exp = "2026-11-12T15:30:00Z"; // 16:30 in Copenhagen
const link = "https://example.test/#invite=abc123";
const FOOT_DA = "Beskeder tjekkes automatisk, før de leveres. Ingen garanti for drift, og data kan blive slettet.";
const FOOT_EN = "Messages are checked automatically before delivery. No uptime guarantee; data may be deleted.";
const split = (html: string) => { const i = html.indexOf("Testversion."); assert(i > 0, "footer present"); return { body: html.slice(0, i), foot: html.slice(i) }; };

for (const lang of ["da", "en"] as const) {
  const da = lang === "da";
  const m = E.inviteMail({ inviterEmail: "nicolai@x.test", link, expires: exp, inviteeEmail: "far@x.test", lang });
  Deno.test(`invitation (${lang}): subject, headline, explanation, big button, fallback link`, () => {
    assertEquals(m.subject, da ? "nicolai@x.test har inviteret dig til Rolff" : "nicolai@x.test has invited you to Rolff");
    assert(m.html.includes(da ? "nicolai@x.test har inviteret dig til at chatte på Rolff" : "nicolai@x.test invited you to chat on Rolff"));
    assert(m.html.includes(da ? "respektfuld tone" : "respectful tone"));
    assert(m.html.includes(da ? "ingen læsekvitteringer" : "no read receipts"));
    assert(m.html.includes(da ? ">Deltag i chatten</a>" : ">Join the chat</a>"));
    assertEquals(m.html.split(`href="${link}"`).length - 1, 2, "button + plain fallback link use the token link");
    assert(m.html.includes(`>${link}</a>`));
    assert(m.html.includes(da ? "Hvis du ikke kender afsenderen, kan du ignorere mailen." : "If you do not know the sender, you can ignore this e-mail."));
    assert(m.html.includes(da ? "berettiget interesse" : "legitimate interest"));
    assert(m.html.includes(da ? "udløber efter 3 dage" : "expires after 3 days"));
    assert(m.html.includes('href="https://example.test/privatliv.html"'));
    assert(m.html.includes(da ? ">Privatlivspolitik</a>" : ">Privacy policy</a>"));
    assert(m.html.includes(da ? "<strong>12. november kl. 16.30</strong>" : "<strong>12 November at 16:30</strong>") || m.html.includes("12. november 16.30") || m.html.includes("12 November, 16:30"), "expiry date");
    assert(m.html.includes("far@x.test"));
  });
  Deno.test(`invitation (${lang}): logo, layout, mobile and dark mode`, () => {
    assert(m.html.includes('src="https://example.test/icons/rolff-192.png"') && m.html.includes('alt="Rolff logo"'));
    assert(m.html.includes("max-width:600px") && m.html.includes('role="presentation"'));
    assert(m.html.includes('name="viewport"') && m.html.includes("@media only screen and (max-width:480px)"));
    assert(m.html.includes('name="color-scheme" content="light dark"') && m.html.includes("@media (prefers-color-scheme:dark)"));
    assert(m.html.includes('bgcolor="#00788A"'), "brand teal with bgcolor fallback");
    assert(!/<script|<link |<iframe/i.test(m.html) && !/src="http:/.test(m.html));
  });
  Deno.test(`invitation (${lang}): no model/provider name in body or footer; slim notice, no yellow block`, () => {
    const { body, foot } = split(m.html);
    assert(!/OpenAI|GPT|Gemini|Zero Data|store:false/i.test(m.html + "\n" + m.text), "no provider or model name in the invitation");
    assert(foot.includes(FOOT_DA) && foot.includes(FOOT_EN));
    assert(!m.html.includes("#fff4d6") && !m.html.includes("⚠"));
    assert(m.html.includes(da ? "Dette er en testversion – brug ikke rigtige eller følsomme oplysninger." : "This is a test version – do not enter real or sensitive information."));
    assert(!m.html.includes("Åbn Rolff") && !m.html.includes("Open Rolff"), "the invitation has one single call to action");
  });
  Deno.test(`invitation (${lang}): plain-text part`, () => {
    assert(m.text.includes(link) && m.text.includes(da ? "Deltag i chatten:" : "Join the chat:"));
    assert(m.text.includes(da ? "kan du ignorere mailen" : "you can ignore this e-mail"));
    assert(m.text.includes(da ? "berettiget interesse" : "legitimate interest"));
    assert(m.text.includes("https://example.test/privatliv.html"));
    assert(m.text.includes("far@x.test") && m.text.includes("Beskeder tjekkes automatisk, før de leveres") && m.text.toLowerCase().includes("messages are checked automatically before delivery"));
    assert(!/<[a-z][^>]*>/i.test(m.text) && !m.text.includes("&amp;"));
  });

  const c = E.copyMail({ inviteeEmail: "far@x.test", expires: exp, lang });
  Deno.test(`confirmation copy (${lang}): same design, Open Rolff button, never the token link`, () => {
    assertEquals(c.subject, da ? "Kopi: Din invitation til far@x.test er sendt" : "Copy: Your invitation to far@x.test has been sent");
    assert(c.html.includes(da ? "Din invitation er sendt" : "Your invitation has been sent"));
    assert(c.html.includes('src="https://example.test/icons/rolff-192.png"') && c.html.includes("max-width:600px") && c.html.includes("@media (prefers-color-scheme:dark)"));
    assert(c.html.includes(da ? ">Åbn Rolff</a>" : ">Open Rolff</a>") && c.html.includes('href="https://example.test/"'));
    assert(!c.html.includes("#invite=") && !c.text.includes("#invite="));
    assert(c.html.includes(da ? "Af sikkerhedshensyn er linket kun med i modtagerens mail." : "For security, the link is only in the recipient&#39;s e-mail."));
    assert(c.html.includes("far@x.test") && c.text.includes(da ? "Åbn Rolff: https://example.test/" : "Open Rolff: https://example.test/"));
    const { body, foot } = split(c.html);
    assert(!/OpenAI|GPT|Gemini|Zero Data|store:false/i.test(c.html + "\n" + c.text) && foot.includes(FOOT_DA) && foot.includes(FOOT_EN) && c.text.includes("Beskeder tjekkes automatisk, før de leveres"));
    assert(!c.html.includes("#fff4d6") && c.html.includes(da ? "Dette er en testversion" : "This is a test version"));
  });
}

Deno.test("invitation: inviter and invitee are HTML-escaped", () => {
  const m = E.inviteMail({ inviterEmail: '<b onload="x">a@x.test', link, expires: exp, inviteeEmail: '"><img src=x>@x.test' });
  assert(!m.html.includes("<b onload") && !m.html.includes("<img src=x"));
  assert(m.html.includes("&lt;b onload=&quot;x&quot;&gt;a@x.test"));
  assertEquals(m.text.includes('<b onload="x">a@x.test'), true, "plain text is not escaped");
});
Deno.test("invitation: token link with special characters is escaped in href", () => {
  const m = E.inviteMail({ inviterEmail: "a@x.test", link: 'https://example.test/#invite=a"b&c', expires: exp, inviteeEmail: "b@x.test" });
  assert(m.html.includes('href="https://example.test/#invite=a&quot;b&amp;c"'));
});
