import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ComposerInput } from "./ComposerInput";
import { effectiveCharLimit } from "./composerLimits";
import "./styles.css";
function Fixture() {
  const [plan,setPlan]=useState("text"); const [text,setText]=useState(""); const [file,setFile]=useState<File|null>(null); const [notice,setNotice]=useState(""); const ref=useRef<HTMLTextAreaElement>(null);
  return <main className="wrap" style={{maxWidth:560}}><h1>Skrivefelttest</h1><p className="meta">Kun opdigtede testdata. Ingen login, AI-kald, betaling eller afsendelse. Den samme komponent bruges i chatten.</p>
    <div className="row"><button onClick={()=>{setPlan("text");setFile(null);}}>49 kr.</button><button onClick={()=>setPlan("text_attachments")}>79 kr.</button><button onClick={()=>setText("a".repeat(161))}>161 tegn</button><button onClick={()=>setText("a".repeat(481))}>481 tegn</button><button onClick={()=>{setText("");setFile(null);setNotice("");}}>Ryd</button></div>
    <p className="meta">Valgt plan: {plan === "text" ? "49" : "79"} kr.</p><div className="card composer"><ComposerInput lang="da" text={text} onText={setText} textareaRef={ref} plan={plan} cap={effectiveCharLimit(plan)} busy={false} file={file} onFile={setFile} openPlans={()=>setNotice("Planoversigten ville åbne her. Ingen plan er ændret.")} canSend={!!file||!!text.trim()} onSend={()=>setNotice("Test: Papirflyet blev trykket. Intet er sendt.")}/>{file&&<p className="meta">Valgt fil: {file.name}<button className="ghost" onClick={()=>setFile(null)}>Fjern fil</button></p>}</div>{notice&&<p className="notice" role="status">{notice}</p>}
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
