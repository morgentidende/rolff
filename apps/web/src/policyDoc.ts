// The in-app privacy policy is read from the SAME public file (privatliv.html) – one source of truth.
// This picks the part for the app language and sanitises it to a small allow-list of tags.
const ALLOWED = new Set(["P", "H1", "H2", "H3", "UL", "OL", "LI", "STRONG", "EM", "CODE", "A", "BR", "SECTION"]);

function clean(node: Node, doc: Document): Node | null {
  if (node.nodeType === 3) return doc.createTextNode(node.textContent ?? "");
  if (node.nodeType !== 1) return null;
  const el = node as Element;
  if (!ALLOWED.has(el.tagName)) {
    if (["SCRIPT", "STYLE", "IFRAME", "OBJECT", "IMG", "HR", "TITLE"].includes(el.tagName)) return null;
    const frag = doc.createDocumentFragment(); el.childNodes.forEach((c) => { const x = clean(c, doc); if (x) frag.appendChild(x); }); return frag;
  }
  const out = doc.createElement(el.tagName.toLowerCase());
  if (el.tagName === "P" && el.classList.contains("draft")) out.className = "draft";
  if (el.tagName === "A") {
    const href = el.getAttribute("href") ?? "";
    if (/^(https?:|mailto:)/i.test(href)) { out.setAttribute("href", href); if (!/^mailto:/i.test(href)) { out.setAttribute("target", "_blank"); out.setAttribute("rel", "noopener noreferrer"); } }
  }
  el.childNodes.forEach((c) => { const x = clean(c, doc); if (x) out.appendChild(x); });
  return out;
}

/** Returns sanitised HTML for "da" (everything before <hr>) or "en" (from <h1 id="en">), plus the
 *  bilingual sections at the end. Drops the "English below" link, the draft repeat and "← Rolff". */
export function policyHtml(source: string, lang: "da" | "en"): string {
  const doc = new DOMParser().parseFromString(source, "text/html");
  const kids = Array.from(doc.body.children);
  const hr = kids.findIndex((k) => k.tagName === "HR");
  const back = kids.findIndex((k) => k.tagName === "P" && k.querySelector('a[href="./"]'));
  const tail = back >= 0 ? kids.slice(back + 1) : [];
  const part = lang === "da" ? kids.slice(0, hr >= 0 ? hr : kids.length) : kids.slice(hr >= 0 ? hr + 1 : 0, back >= 0 ? back : kids.length);
  const out = doc.createElement("div");
  for (const k of [...part, ...tail]) {
    if (k.querySelector?.('a[href="#en"]')) Array.from(k.querySelectorAll("a[href=\"#en\"]")).forEach((a) => a.remove());
    const c = clean(k, doc); if (c) out.appendChild(c);
  }
  // In-app the screen header already says "Privatlivspolitik"; keep the h1 but without duplicate draft banners.
  return out.innerHTML.replace(/\.\s+\.\s*<\/p>/g, ".</p>").replace(/\s{2,}/g, " ");
}
