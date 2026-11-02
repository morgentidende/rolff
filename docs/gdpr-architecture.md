# GDPR-arkitektur for Rolff (design)

> **UDKAST – skal gennemgås af jurist/DPO før rigtig drift.** Ikke en juridisk vurdering eller certificering.
> Status 2026-11-02: design. Intet af nedenstående er implementeret, medmindre det står "findes i dag".

## 1. Dataflow (ærligt)

```
Afsender-enhed ──TLS──> Edge Function send-message (Supabase, Frankfurt)
   │                         │ 1) regler (lokalt i funktionen)
   │                         │ 2) kort uddrag → AI-leverandør (OpenAI EU/ZDR mål; i test: Gemini gratis)
   │                         ▼
   │                    Postgres (Frankfurt, krypteret disk) – serverkopi
   │                         │ levering efter modtagerens modtagetider
   ▼                         ▼
Lokal krypteret kopi   Modtager-enhed (lokal krypteret kopi)
(IndexedDB + WebCrypto)
```

- Serveren **ser beskedteksten** (ikke E2E): den skal til AI-tjekket og holdes, indtil modtageren har hentet den.
- **Mål:** serverkopien slettes, når alle modtagere har hentet beskeden (+ evt. modtagevindue), medmindre brugeren har slået sky-synk til. Indtil det er bygget, ligger beskeder på serveren uden udløb (findes i dag).
- AI: kun afsenderens besked + højst 10 korte kontekstbeskeder (findes i dag: `ctx.slice(-10)`; mål: afkort hver til fx 280 tegn).

## 2. Standarder

| Indstilling | Standard | Valg |
|---|---|---|
| Lagring | Lokalt på enheden, krypteret (web: IndexedDB, AES-GCM-nøgle fra WebCrypto, ikke-eksporterbar; mobil: Keychain/Keystore) | – |
| Sky-synk | **Fra** (eksplicit opt-in) | Til/fra. Fra → sky-kopi og synk-nøgle slettes straks |
| Opbevaring | **1 år** (loft) | 1 år / 5 år / ubegrænset |
| Inaktivitet | Sletning efter 90 dage uden login, advarsel 14 og 3 dage før (mail uden indhold) | Kan fravælges |

Bemærk: lokal kryptering i browseren beskytter mod tilfældig adgang til lagret data, ikke mod en kompromitteret enhed eller browser.

## 3. Datamodel (ny)

- `user_privacy(user_id pk, cloud_sync bool default false, retention text check in ('1y','5y','unlimited') default '1y', inactivity_delete bool default true, last_seen_at timestamptz, warned_at timestamptz)`
- `message_deliveries.fetched_at` (findes delvist) → bruges til "alle har hentet".
- Synk-nøgle: kun hvis sky-synk: `sync_keys(user_id, wrapped_key bytea)` – nøglen er wrappet på klienten; slettes ved fravalg/sletning.

## 4. Sletning

| Udløser | Handling |
|---|---|
| (a) Bruger sletter konto (⋮ → Slet konto, bekræftelse med tydelig tekst + skriv e-mail) | Edge Function `delete-account` (service role, kun egen bruger): sletter feedback, aliaser, præferencer, synk-nøgle, invitationer oprettet af brugeren, egne beskeder **på serveren**, medlemskaber, og til sidst `auth.users`. Klienten rydder IndexedDB + nøgle. |
| (b) Inaktivitet | Planlagt job (pg_cron dagligt): advarselsmail (ingen indhold) → sletning som (a). I test: kun bot-adresser. |
| (c) Art. 17-anmodning | Samme funktion køres af Rolff efter verifikation. |
| Opbevaringsfrist | Dagligt job sletter serverkopier ældre end den strengeste frist blandt samtalens deltagere; klienten sletter lokalt efter egen frist. |

**Modpartens kopi – BESLUTTET (Nicolai, 2026-11-02): Rolff er en bevis-app.** Når én part sletter (slet-knap, inaktivitet, art. 17), fjernes KUN den slettende parts egne data: egen lokale kopi (localStorage/IndexedDB/cache på enheden), egen sky-kopi, egen synk-nøgle, egne indstillinger/kaldenavne/farver/feedback og auth-brugeren. Modparten beholder fuld adgang til hele samtalen indtil sletningen – uændret (samme beskeder, tekst og tidspunkter; afsender vises som "Slettet bruger"). Beskeder, der var sendt men endnu ikke leveret pga. modpartens modtagetider, leveres stadig. Samtaler uden andre aktive medlemmer slettes helt.

Server/sky-model: I dag ligger hver besked som én serverrække, som alle medlemmer læser via `get_messages`; sletning nulstiller kun `sender_id` (FK `on delete set null`) og fjerner den slettendes medlemskab – den slettende mister adgang, modparten mister intet. Når lokal kryptering og sky-synk (trin 3/7) bygges, gøres sky-kopier **ejet pr. part** (`(owner_id, message_id)` krypteret med ejerens synk-nøgle), så én parts sletning eller synk-fra kun fjerner ejerens rækker og aldrig rører den andens. Relay-rækken (server-transit) slettes først, når alle modtagere har fået beskeden og deres egen kopi findes.

Det er ikke en ret til at kræve modpartens kopi slettet; det står i privatlivspolitikken og vises kort ved kontooprettelse, invitation og accept samt ved slet-knappen. Inaktivitetssletning: standard til, 90 dage (30/60/90, kan fravælges), advarselsmail uden indhold 14 dage før; i testmiljø kun til adresser på `TEST_MAIL_ALLOW` (bot-indbakken). Kørsel: pg_cron dagligt → pg_net → Edge Function `inactivity-sweep` (beskyttet af `CRON_SECRET`).

Tests: efter sletning må ingen rækker med brugerens id findes i nogen tabel (generisk test over `information_schema`), auth-bruger væk, modpartens samtale stadig gyldig.

## 5. AI-leverandør

- Interface findes (`ModerationProvider`). OpenAI-provider skal bruge base-URL fra env: `https://eu.api.openai.com` (kræver **nyt projekt med Europe data residency**, og MAM/ZDR-berettigelse via OpenAI sales; jf. https://developers.openai.com/api/docs/guides/your-data, verificeret 2026-11-02, nævner `eu.api.openai.com` og `gpt-5.4-nano`), model `gpt-5.4-nano`, `store:false`.
- Feature-flag `MODERATION_PROVIDER=openai|gemini`; Gemini gratis kun når `APP_ENV!=production` (findes i dag).
- **OpenAI-nøgle mangler** (`/workspace/.secrets/openai_api_key` findes ikke). ZDR omtales i UI kun som "under godkendelse", indtil Nicolai bekræfter.

## 6. Ingen overvågning

Ingen rapportér-knap, ingen analytics, ingen indhold i logs. CI-test: statisk scanning af `supabase/functions/**` for `console.*(` med `body`/`text`/`msg`/`ctx` i argumenterne, plus runtime-test der fanger `console.log` under moderation-tests og fejler, hvis testbeskeden optræder.

## 7. Underdatabehandlere

Supabase (DB, auth, functions – Frankfurt), Hostinger (web + mail-relay), OpenAI (mål, EU/ZDR) / Google Gemini (kun test). Rolff/Nicolai er dataansvarlig – også i on-device-tilstand. Børn under 13 kan ikke selv give samtykke i Danmark (forældresamtykke kræves).

## 8. Rækkefølge
1) Dette dokument → 2) slet-knap + sletning → 3) sky/opbevaring-indstillinger + retention-job → 4) FAQ + privatlivspolitik → 5) OpenAI-provider (mock) → 6) lokal kryptering.

## 9. Download mine data (art. 15) – design

- ⋮ → "Download mine data" → genindtast kodeord (`signInWithPassword` med egen e-mail) → RPC `export_my_data()` (security definer, kun `auth.uid()`, rate limit fx 3/døgn i `moderation_attempts`-lignende tabel uden indhold).
- Indhold: konto (e-mail, oprettet), indstillinger (sprog/tema fra klienten, modtagetider, farver, **egne** kaldenavne, **egne** blokerede ord, opbevaring/synk), medlemskaber (rolle, joined/left), samtykker og invitationer brugeren har oprettet/accepteret, egen feedback, og beskeder via samme regler som `get_messages` (egne + leverede, kun fra eget `joined_at`).
- Aldrig: modpartens kaldenavne, blokerede ord, indstillinger, farver eller ikke-leverede beskeder.
- Filen bygges **på enheden**: JSON + ZIP med CSV-filer (UTF-8 BOM, formel-escape via `exportUtil.csvCell`). Serveren logger intet indhold.
- Tests: to brugere med private data hver → eksporten indeholder kun egne rækker; alle tabeller med `user_id` er dækket (test over `information_schema`); ikke-leverede beskeder udelades.
- Nævnes i FAQ og privatlivspolitik.

## Rapportering (besluttet 2026-11-02, Apple 1.2 / Google Play UGC)
- Adgang: samtalens ⋮ → "Rapportér". Kontakt (nicolaipetersen108@gmail.com) står i FAQ.
- Brugeren vælger selv indholdet: kategori (Chikane/trusler, Upassende indhold, Børns sikkerhed, Andet), egen tekst (≤2000 tegn) og højst 20 selvmarkerede beskeder. Forhåndsvisning + eksplicit bekræftelse; intet sendes automatisk.
- Modtager: mail via samme PHP-mailer som feedback til `FEEDBACK_TO`. Ingen moderationsteam, ingen døgnvagt, ingen garanti for svar/handling; ved akut fare 112/politi.
- Server: `report` Edge Function (kun indlogget, validering) → `submit_report` RPC tjekker medlemskab, at hver vedhæftet besked er synlig for rapportøren (get_messages-regler) og rate limit 3/døgn.
- Opbevaring: kun `report_log` (bruger, samtale, kategori, antal vedhæftede, tidspunkt). Ingen tekst gemmes og ingen tekst logges; indholdet findes kun i mailen. Slettes med kontoen (cascade).
