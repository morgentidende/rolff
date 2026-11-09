# Udskrift af samtale (signeret, til advokat/myndighed)

Status: bygget og testet, **ikke frigivet**. Intet her er anvendt i produktion.

## Sådan virker det
- Kun planen *Tekst + vedhæftninger* (79 kr.). Håndhæves på serveren (`_effective_plan` i Edge-funktionen og igen i `begin_conversation_export`). 49-plan ser et opgraderingstilbud.
- Appen sender kun en anmodning (samtale, periode, modtager, `confirm: true`). **Intet genereres eller downloades på enheden.**
- `export-conversation` (Edge) henter beskeder med `get_export_messages` (samme synlighedsregler som `get_messages`: aktivt medlemskab, `joined_at`, opbevaringsperiode, egne eller frigivne leveringer). Vedhæftninger listes med navn og SHA-256, aldrig indhold.
- PDF'en bygges med jsPDF + indlejrede Noto-fonte (`_shared/pdf`), signeres (PKCS#7/CMS detached, SHA-256, `adbe.pkcs7.detached`, ByteRange over hele filen), og **derefter** hashes de endelige bytes og registreres (`finish_conversation_export`) før e-mailen sendes via `mail.php` med PDF'en vedhæftet.
- Mislykkes mailen, markeres eksporten `failed` (`mark_conversation_export_failed`): den kan ikke verificeres, og notitsen i samtalen fjernes.
- Hver side har kode + QR til `tjek.html?k=KODE`. Den offentlige side hasher filen i browseren (filen sendes ikke) og kalder `verify-export`, der kun svarer `match` / `code_valid` / `mismatch` + tidspunkt, periode, antal beskeder og sider. Aldrig indhold, navne, e-mails eller id'er.
- Misbrugsværn: e-mailvalidering, bekræftelsestrin med modtager, 3/time og 10/døgn pr. bruger (heraf højst 5 til andre adresser), modtager logges i det service-only register, kvittering til kontoens e-mail ved anden modtager, verify-rate-limit 20/10 min pr. hashet IP, verifikationskoder på 80 bit tilfældighed.
- Fairness: `conversation_events` viser "X har lavet en udskrift af samtalen" i samtalen for alle deltagere, der kan se tidspunktet.

## Frigivelse (kræver Nicolais godkendelse)
1. Migration `supabase/migrations/20261109120000_conversation_exports.sql` på projekt **dubwlbqazbllnwpsqrjv** (via den officielle migrations-vej; ikke den forkert bundne connector).
2. Secrets på projektet (sættes manuelt, aldrig i git):
   ```sh
   # selvsigneret testcertifikat (kan senere erstattes af et AATL-certifikat i samme format)
   openssl req -x509 -newkey rsa:3072 -sha256 -days 1095 -nodes \
     -keyout rolff-sign.key -out rolff-sign.crt \
     -subj "/CN=ROLFF udskrift/O=ROLFF/C=DK" \
     -addext "keyUsage=critical,digitalSignature,nonRepudiation"
   openssl pkcs12 -export -inkey rolff-sign.key -in rolff-sign.crt -out rolff-sign.p12 -name "ROLFF udskrift" -passout pass:"$P12_PASS"
   supabase secrets set --project-ref dubwlbqazbllnwpsqrjv \
     EXPORT_SIGNING_P12_B64="$(base64 -w0 rolff-sign.p12)" EXPORT_SIGNING_P12_PASSWORD="$P12_PASS" \
     VERIFY_IP_SALT="$(openssl rand -hex 32)"
   shred -u rolff-sign.key   # opbevar .p12 + kodeord sikkert offline
   ```
   Uden `EXPORT_SIGNING_P12_*` svarer funktionen 503 `signing_unavailable` (ingen usignerede udskrifter).
3. Deploy Edge-funktionerne `export-conversation` (verify_jwt = true) og `verify-export` (verify_jwt = false).
4. Upload ny `api/mail.php` (understøtter valgfri PDF-vedhæftninger). Rør ikke `api/config.php` og `.htaccess`.
5. Frontend-build inkl. `tjek.html`.

## Begrænsninger / opfølgning
- Selvsigneret certifikat: Adobe viser ikke grønt flueben. Et AATL/kvalificeret certifikat kan sættes ind uden kodeændring.
- Intet RFC 3161-tidsstempel (signer-p12 understøtter ikke TSA). Tidspunkter er serverens; registret er tidsankeret i databasen.
- Emoji vises monokromt. Maks. 5000 beskeder pr. udskrift (brug periode).
- Opbevaringspolitik for `recipient_email` i registret er en opfølgning.
- Rolff udtaler sig ikke om juridisk gyldighed eller bevisværdi.
