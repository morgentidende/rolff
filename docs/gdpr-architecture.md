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

**Modpartens kopi (defineret adfærd):** Beskeder, som modparten allerede har modtaget, ligger på modpartens enhed (og i modpartens sky, hvis slået til). Rolff kan ikke fjerne data fra en andens enhed. Ved sletning (a)–(c): serverkopier af den slettedes beskeder slettes; modpartens lokale kopi bevares og vises med afsender "Slettet bruger". Dette skal stå i privatlivspolitikken. Alternativ (beslutning Nicolai): også slette modpartens sky-kopi af den slettedes beskeder.

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
