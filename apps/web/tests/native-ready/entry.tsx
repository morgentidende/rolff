import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ComposerInput } from "../../src/ComposerInput";
import { useBackNavigationRoot } from "../../src/backNavigation";
const w = window as any;
w.QA = { clicks: [] as string[], lang: w.__lang === "en" ? "en" : "da" };
// Record picker opens instead of opening a real system picker.
HTMLInputElement.prototype.click = function (this: HTMLInputElement) { w.QA.clicks.push(this.getAttribute("capture") ? "camera" : "file"); };
function Fixture() {
  useBackNavigationRoot();
  const ref = useRef<HTMLTextAreaElement>(null); const [text, setText] = useState("");
  return <main className="wrap"><ComposerInput lang={w.QA.lang} text={text} onText={setText} textareaRef={ref} plan="text_attachments" cap={480} busy={false} file={null} onFile={() => {}} onSend={() => {}} openPlans={() => {}} canSend={false} /></main>;
}
const root = createRoot(document.getElementById("root")!); root.render(<Fixture />);
w.QA.unmount = () => root.unmount();
