# Plan: delvis offentliggørelse af Rolffs databehandlingskode

> Status: **plan**. Repoets synlighed er ikke ændret. Skrevet 2026-11-02.
> Formål (Nicolai): tillidssignal over for fx Børns Vilkår og Foreningen Far – "se selv, hvordan vi håndterer data".

## 1. Faktatjek – hvad findes i koden nu (main, 2026-11-02)

| Emne | Fakta | Kilde |
|---|---|---|
| Kryptering | **Der findes intet applikations-krypteringslag.** Beskeder ligger i klartekst i Postgres (`public.messages.body`). Supabase krypterer disken (at rest) og al trafik er TLS. Kun invitationstokens gemmes som SHA-256-hash, og godkendelser bindes til SHA-256 af teksten. **Rolff er ikke ende-til-ende-krypteret og må ikke påstå det.** | `supabase/migrations/20261101000000_core.sql`, README |
| Retention | **Der findes ingen sletnings-/retention-logik.** Beskeder, leverancer, `moderation_attempts` (uden tekst) og udløbne `moderation_approvals` (kun hash) bliver liggende. `on delete cascade` fra `auth.users` er eneste sletningsvej. | migrations (ingen `delete`/cron) |
| Moderation | `send-message`: auth → `prepare_send` (medlemskab, rolle, længde, rate limit) → regelbaseret forfilter (`_shared/rules.ts`: blokerede ord, emoji, caps, gentagelser) → LLM (`_shared/moderation.ts`, Gemini eller OpenAI via `MODERATION_PROVIDER`) med beskeden + højst 10 seneste beskeder som kontekst → streng JSON-validering (fail closed) → engangsgodkendelse (afsender + samtale + SHA-256, 60 s) → `commit_message` (idempotent). | `supabase/functions/send-message`, `_shared/*` |
| LLM-leverandør | Test kører på **Gemini gratis niveau** (Google må bruge input til forbedring → kun opdigtede beskeder). OpenAI-provider findes med `store:false`, men **ingen OpenAI-nøgle er sat op**, og Zero Data Retention (ZDR) er **ikke** godkendt endnu. `APP_ENV=production` nægter gratis niveau. | `_shared/moderation.ts` |
| Logs | Ingen `console.log` med beskedtekst i Edge Functions (kun hændelseskoder). **Men:** Supabase/Hostinger har egne platformlogs (request-metadata), og vi har ikke en automatisk test, der forhindrer fremtidig logning af tekst. Feedback-funktionen mailer feedbackteksten (ikke samtalebeskeder) til en intern adresse. | `send-message/index.ts`, `feedback/index.ts` |
| Analytics | Ingen analytics/tredjeparts-scripts i webappen. | `apps/web` |
| Hosting | Database/Edge Functions: Supabase, region `eu-central-1` (Frankfurt). Web + mail-relay: Hostinger. | Management API |

### Hvad kan siges sandfærdigt?
- ❌ "Vi gemmer ikke jeres data" – **forkert**. Beskeder gemmes i databasen (i dag uden udløb).
- ❌ "Ende-til-ende-krypteret" / "certificeret".
- ✅ "Beskeder gemmes krypteret på disk i EU (Frankfurt) og sendes kun krypteret (TLS)."
- ✅ "Vi logger ikke beskedtekst, og der er ingen analytics eller annoncesporing." (bør bakkes op af en CI-test, se §3)
- ✅ "Ingen læsekvitteringer, online-status eller rapportér-knap."
- ✅ Først når betalt OpenAI-projekt med ZDR er godkendt: "AI-tjekket kører hos en leverandør, der ikke gemmer eller træner på jeres beskeder." Indtil da: "under godkendelse".
- ✅ Når retention er bygget (se `docs/gdpr-architecture.md`): "Serveren sletter beskeder efter levering/opbevaringsfrist, medmindre du slår sky-synk til."

## 2. Anbefalet struktur

GitHub kan ikke gøre dele af et repo offentligt. Muligheder:

| Løsning | Fordele | Ulemper |
|---|---|---|
| **A. Separat offentligt repo `rolff-trust`** (moderation-pipeline, regler, validering, retention-SQL, evt. krypteringsmodul + tests), importeret i den private app som **versioneret pakke** (JSR/npm, Deno kan importere direkte) | Én sandhedskilde; den offentlige kode er *præcis* den, der kører; tests kører offentligt i CI; tydelig versionering ("app kører rolff-trust v1.3") | Kræver ren grænseflade (allerede næsten: `_shared/moderation.ts`, `rules.ts` er rene moduler); release-flow |
| B. git submodule/subtree | Ingen pakkeregistrering | Submodules er skrøbelige i CI/deploy; subtree giver dobbelthistorik |
| C. Kopiering ved release | Simpelt | Divergerer; kan ikke bevise, at offentlig kode = drift → svækker tillidssignalet |

**Anbefaling: A** – offentligt repo `morgentidende/rolff-trust` udgivet til JSR (gratis), som Edge Functions importerer med fast version. SQL for retention/sletning ligger i `rolff-trust/sql/` og kopieres ind som migration med checksum-test i det private repo.

Indhold: `moderation/` (interface, validering, prompt – se risici), `rules/`, `retention/` (SQL + tests), `crypto/` (når lokal kryptering findes), `docs/dataflow.md`, `SECURITY.md`. **Ikke**: invitationer, farver, alias, UI.

### Licens (beslutning: Nicolai)
| Licens | Effekt for salg/white-label |
|---|---|
| Apache-2.0 | Maksimal tillid og genbrug; konkurrenter må bruge koden i lukkede produkter. Patentklausul. |
| AGPL-3.0 | Ændringer i netværkstjenester skal deles; afskrækker lukket genbrug. Rolff (copyright-ejer) kan stadig dual-licensere til organisationer. |
| Source-available (fx BSL 1.1 / PolyForm) | "Se, men ikke genbrug kommercielt". Ikke OSI open source → svagere signal over for nogle partnere. |

Anbefaling: **Apache-2.0** for tillidskoden (den er ikke den kommercielle værdi; værdien er appen, driften og white-label-aftalen). Alternativt AGPL hvis Nicolai vil hindre konkurrenter. Kræver at al kode er skrevet af/tilhører Rolff (gælder i dag).

## 3. Oprydning før offentliggørelse

Scan 2026-11-02 (hele historikken, alle refs, 27 commits):
- **gitleaks** (`git --log-opts=--all`): 0 fund. **trufflehog** (git): 0 verificerede, 0 uverificerede.
- Målrettet søgning efter de faktiske hemmeligheder (Supabase-token, Gemini-nøgle, mail-relay-secret, testkonto-kodeord): **0 forekomster** i historikken.
- Arbejdsmappen: 2 fund kun i `apps/web/dist/` (gitignored build): mail-relay-config og publishable key i bundle (publishable er offentlig af design).

Tjekliste (gælder især hvis koden flyttes/udgives):
- [ ] Nyt repo starter med **ren historik** (kopi af udvalgte filer, ikke fork) → intet fra privat historik følger med.
- [ ] Gentag gitleaks + trufflehog på det nye repo + tilføj gitleaks i CI.
- [ ] Fjern projekt-ref `dubwlbqazbllnwpsqrjv`, Hostinger-domæne og `supabase/.temp/` (er committet i dag – bør fjernes og gitignores også i det private repo).
- [ ] Ingen testkonto-adresser (`*@mail.grokbot.com`), ingen kodeord-referencer; tests bruger `*.invalid`.
- [ ] Interne README-noter og `docs/moderation-results.md` (nævner projekt-ref) gennemgås.
- [ ] Testkorpus (`tests/moderation/corpus.json`, 57 syntetiske eksempler inkl. sårende tekst): syntetisk og må gerne med, men med forklaring; overvej at udelade de mest grove.
- [ ] **Prompt** (`SYSTEM_PROMPT`): beslutning (Nicolai) – fuld, forkortet eller beskrevet. Se risici.
- [ ] Rate limits/sikkerhedstærskler: flyt tal til konfiguration; publicér princippet, ikke nødvendigvis tallene.
- [ ] CI uden secrets (er tilfældet i dag: kun dummy-værdier).
- [ ] `LICENSE`, `SECURITY.md` (sikkerhedsadresse, svartid, ingen bounty), `CONTRIBUTING.md` (DCO/CLA hvis dual-licens).
- [ ] `docs/dataflow.md` med diagram (se `docs/gdpr-architecture.md`).
- [ ] DPA/GDPR-note: underdatabehandlere, region, "udkast – skal gennemgås af jurist/DPO".
- [ ] CI-test der fejler hvis beskedtekst logges (se GDPR-dokumentet).

## 4. Tidslinje og afhængigheder

| # | Trin | Afhænger af | Beslutning (Nicolai) |
|---|---|---|---|
| 1 | Denne plan + GDPR-arkitektur | – | – |
| 2 | Slet-knap, retention, sky-opt-in bygget og testet | 1 | Standardfrister |
| 3 | Log-lint/test i CI | – | – |
| 4 | OpenAI betalt projekt, EU data residency + ZDR **godkendt af OpenAI**, nøgle sat som secret, `MODERATION_PROVIDER=openai` | Nøgle mangler i dag | Ansøgning/kontrakt |
| 5 | Udtræk `rolff-trust` med ren historik, tests, licens, SECURITY.md | 2, 3 | **Licens**, **prompt-synlighed** |
| 6 | Uafhængig gennemlæsning (jurist/DPO + sikkerhed) | 5 | – |
| 7 | Gør `rolff-trust` offentligt, link fra app/FAQ | 4, 6 | Go/no-go |

**Ingen rigtige brugere før trin 4** (betalt, ikke-trænende tier).

## 5. Risici

- **Omgåelse:** Offentlig prompt og regler gør det lettere at formulere sårende beskeder, der slipper igennem. Afbødning: publicér arkitektur, validering og fail-closed-logik, men hold prompt/ordliste i privat konfiguration, eller accepter risikoen (Kerckhoffs: sikkerhed må ikke bero på hemmelighed – men moderation er ikke kryptografi).
- **Prompt injection-forsøg** målrettet den kendte prompt → behold streng validering + tests.
- **Sikkerhed:** Offentlig RLS/SQL viser angrebsflade; afbødes af at RLS-tests er offentlige og grønne. Sikkerhedshuller kræver kanal (SECURITY.md).
- **Omdømme:** Påstande der ikke holder ("vi gemmer ikke data", "E2E") kan blive afsløret netop fordi koden er offentlig → brug kun formuleringerne i §1.
- **Divergens:** Offentlig kode ≠ drift → løses med versioneret pakke (A).
- **Juridisk:** Offentlig kode er ikke en certificering; skriv det.
