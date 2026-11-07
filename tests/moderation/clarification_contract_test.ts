// DRAFT for proposed clarify/unclear_meaning contract. Not expected to pass before implementation.
import {validateResult,moderate,ModerationTechnicalError} from "../../supabase/functions/_shared/moderation.ts";
import {validateFileResult} from "../../supabase/functions/_shared/attachments.ts";
const eq=(a:unknown,b:unknown)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error("mismatch")};
const raw={decision:"clarify",reason_code:"unclear_meaning",spans:[],suggestion:""};
Deno.test("clarify is semantic result, no invented rewrite",()=>eq(validateResult(raw,"Aftalen er plimvax nudro."),raw));
Deno.test("clarify has no harmful reason, spans or suggestion",()=>{for(const change of [{reason_code:"personal_attack"},{suggestion:"Kan vi mødes?"},{spans:["plimvax"]},{reason_code:"none"}]){let thrown=false;try{validateResult({...raw,...change},"Aftalen er plimvax nudro.")}catch(e){thrown=e instanceof ModerationTechnicalError}if(!thrown)throw Error("accepted inconsistent clarify")}});
Deno.test("allow cannot carry clarification reason or rewrite",()=>{for(const result of [{...raw,decision:"allow"},{decision:"allow",reason_code:"none",spans:[],suggestion:"Omskrivning"}]){let thrown=false;try{validateResult(result,"Kan vi mødes kl. 15?")}catch{thrown=true}if(!thrown)throw Error("accepted inconsistent allow")}});
Deno.test("mock provider clarify survives moderate without technical error",async()=>{const provider={name:"mock",model:"synthetic",moderate:async()=>raw};eq((await moderate(provider,"Aftalen er plimvax nudro.",[])).decision,"clarify")});
Deno.test("attachment parser shares semantic clarify contract",()=>{const r=validateFileResult({...raw,transcript:"Tidspunkt: plimvax nudro."},"");eq(r.decision,"clarify");eq(r.suggestion,"")});
