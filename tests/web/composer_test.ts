const assert = (value: boolean, label: string) => { if (!value) throw new Error(label); };
Deno.test("Real composer has paperclip/camera and a right-hand send plane", async () => {
 const s=await Deno.readTextFile("apps/web/src/ComposerInput.tsx");
 assert(s.indexOf('choose("file")') < s.indexOf('<textarea'),"paperclip is before textarea");
 assert(s.indexOf('choose("camera")') > s.indexOf('<textarea') && s.indexOf('choose("camera")') < s.indexOf('className="composer-send"'),"camera follows text inside writing surface, before send plane");
 assert(s.includes("composer-entry") && s.includes("composer-entry-row"),"text and attachment icons share one writing surface");
 assert(s.indexOf('className="composer-send"') > s.indexOf('<textarea'),"plane is to right of textarea");
 assert(s.includes('capture="environment"'),"mobile camera capture");
 assert(s.indexOf('if (plan !== "text_attachments")') < s.indexOf('input.click()'),"upgrade before picker");
 assert(!s.includes('getUserMedia'),"no proactive webcam permission");
});
Deno.test("Message field grows without manual resize, never silently truncates", async () => {
 const s=await Deno.readTextFile("apps/web/src/ComposerInput.tsx"); const css=await Deno.readTextFile("apps/web/src/styles.css");
 assert(s.includes('rows={1}') && s.includes('el.scrollHeight'),"starts one line and auto sizes");
 assert(css.includes('resize:none'),"no drag handle");
 assert(!s.includes('maxLength='),"no silent browser truncation");
 assert(s.includes('count > cap'),"over-limit send blocked");
});

Deno.test("Exact saved text retry remains possible after downgrade; edited drafts never bypass UI quota", async () => {
  const { textRetryKey } = await import("../../apps/web/src/composerLimits.ts");
  const key = "00000000-0000-4000-8000-000000000001";
  const text = "a".repeat(300);
  const saved = JSON.stringify({ text, reply: null, key });
  if (textRetryKey(saved, text, null) !== key) throw new Error("Historical retry key lost");
  for (const bad of [textRetryKey(saved, text + "b", null), textRetryKey(saved, text, key), textRetryKey("{", text, null), textRetryKey(null, text, null)]) {
    if (bad !== null) throw new Error("Different or malformed draft matched");
  }
  const ui = await Deno.readTextFile("apps/web/src/ComposerInput.tsx");
  const app = await Deno.readTextFile("apps/web/src/App.tsx");
  if (!ui.includes("count > cap && !retry") || !app.includes("count(text) > cap && !retryKey")) throw new Error("Exact retry disabled after downgrade");
  if (!app.includes("const retryKey = !file ?")) throw new Error("Text key must not authorize attachment retries");
});
