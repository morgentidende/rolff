import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { PushSettings } from '../../src/PushSettings';
import { calls,reset } from './mock-push';
const uid='10000000-0000-4000-8000-000000000001';reset('offer');
function Fixture(){const [mode,setMode]=useState('offer'),[rev,setRev]=useState(0);return <div className="wrap"><h1>ROLFF — syntetisk notifikationsprøve</h1><p className="notice">Kun lokale mocks. Ingen rigtig tilladelse, konto, server, besked eller push. Den virkelige funktion er fortsat slukket.</p><div className="row">{['offer','settings','unsupported','denied','unavailable'].map(m=><button key={m} onClick={()=>{reset(m);setMode(m);setRev(x=>x+1);}}>{m}</button>)}</div><PushSettings key={rev} uid={uid} lang="da" onboarding={mode==='offer'}/></div>;}
const root=createRoot(document.getElementById('root')!);root.render(<Fixture/>);
(window as any).QA={calls,unmount:()=>root.unmount()};
