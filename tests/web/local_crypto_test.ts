// Runs the WebCrypto parts of localStore in Deno (IndexedDB not needed for these).
import { seal, unseal } from "../../apps/web/src/localCrypto.ts";
Deno.test("Lokal kryptering: AES-GCM, ikke-eksporterbar nøgle, AAD binder til bruger+samtale", async () => {
  const k = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  let exp = false; try { await crypto.subtle.exportKey("raw", k); } catch { exp = true; }
  if (!exp) throw new Error("key exportable");
  const box = await seal(k, [{ body: "hemmelig" }], "u:c");
  if (new TextDecoder().decode(box.ct).includes("hemmelig")) throw new Error("plaintext");
  const back = await unseal<any[]>(k, box, "u:c"); if (back[0].body !== "hemmelig") throw new Error("roundtrip");
  let bad = false; try { await unseal(k, box, "u:other"); } catch { bad = true; }
  if (!bad) throw new Error("aad");
});
