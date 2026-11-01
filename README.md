# Rolff

Rolig chat for skilte forældre. Beskeder vurderes semantisk (inkl. ironi, sarkasme og falsk høflighed) på serveren **før** afsendelse, og modtageren styrer selv, hvornår nye beskeder bliver tilgængelige.

> Status: tidlig vertikal skive (login → invitation → besked med moderation → modtagelse). Ikke produktionsklar.

## ⚠️ Gratis Gemini-niveau = kun syntetiske testdata
På Googles gratis niveau må Google bruge input til at forbedre sine produkter. Derfor:
- `MODERATION_TIER=free` må **kun** bruges med opdigtede testbeskeder og testkonti.
- Med `APP_ENV=production` nægter serveren at køre på gratis niveau (`free_tier_forbidden_in_production`) og afviser afsendelse (fail closed). Produktion kræver `MODERATION_TIER=paid` (betalt Gemini eller OpenAI med `store:false`).

## Struktur
| Sti | Indhold |
|---|---|
| `supabase/migrations/` | Skema, RLS, RPC'er (medlemsperioder, roller, invitationer, samtykker, beskeder, leverancer, godkendelser, modtagetider, indholdsløse notifikationsjobs) |
| `supabase/functions/send-message` | Serverhåndhævet afsendelse: auth → medlemskab/rolle/længde/rate → forfilter → LLM → streng validering → engangsgodkendelse (afsender+samtale+SHA-256 af tekst, 60 s) → atomisk forbrug + lagring (idempotent) |
| `supabase/functions/invitation` | Opret / accepter / tilbagekald / samtykke |
| `supabase/functions/receive-now` | "Modtag beskeder nu" for den kaldende bruger |
| `supabase/functions/_shared/moderation.ts` | Udbyderuafhængigt interface (Gemini, OpenAI) valgt via `MODERATION_PROVIDER` |
| `apps/web` | Webdemo (Vite + React, DA/EN, lys/mørk). Logikken er klientuafhængig, så en Expo/React Native-app (iPhone + Android) kan bruge samme backend. |
| `tests/sql` | 36 integrationstests af skema/RLS/RPC'er i rigtig Postgres (PGlite) |
| `tests/moderation` | Unit-tests + testkorpus (57 DA/EN eksempler) mod rigtig model |

## Designvalg (privatliv)
- Ingen klientadgang til `messages`/`message_deliveries`; kun RPC `get_messages`, som returnerer egne + frigivne beskeder fra eget `joined_at`. Ingen Realtime på beskeder (klienten poller), så ventende beskeder kan ikke lække via Realtime.
- Ingen kvitterings-, online- eller skrivesignaler findes i skema eller svar. Afsender får kun "accepteret".
- Modtagetider beregnes i Postgres med tz-databasen (sommertid, vinduer over midnat).
- Invitationstokens gemmes kun som SHA-256; fejl er generiske. Ekstra medlemmer kræver samtykke fra alle aktive forældre, bundet til rolle og `member_version`.
- Ingen beskedtekst i logs. Service-role-nøglen findes kun i Edge Functions.
- Ikke ende-til-ende-krypteret: klartekst ligger i Postgres (krypteret at rest hos Supabase) og sendes til AI-udbyderen ved vurdering.

## Kør tests
```
npm run test:sql
npm run test:moderation-unit
GEMINI_API_KEY=... npm run test:corpus     # kun syntetiske data
```

## Opsætning
1. Opret Supabase-projekt, kør migrationer (`supabase db push`).
2. Auth: e-mail/adgangskode; slå e-mailbekræftelse fra **kun** i testmiljø.
3. `supabase secrets set` med værdierne i `supabase/.env.example`; `supabase functions deploy send-message invitation receive-now`.
4. `apps/web/.env` med URL + publishable key; `npm run build:web`; host `apps/web/dist` statisk.

Se `docs/moderation-results.md` for observerede moderationsresultater.

## Testkonto og e-mailinvitationer
- Testkontoen til Nicolai har en bevidst svag adgangskode **kun til denne test**. Den er sat direkte i databasen (Supabase kræver ellers mindst 6 tegn) og må aldrig bruges i produktion. Adgangskoder ligger kun uden for repoet.
- Invitation via e-mail: Edge Function `invite-email` opretter en ny samtale og en invitation bundet til modtagerens e-mail (72 t, engangs). Modtageren får en mail med link (`#invite=TOKEN`), den inviterende en kopi uden link.
- Mail sendes via `apps/web/public/api/mail.php` på Hostinger-sitet (PHP `mail()`, gratis i den eksisterende hostingplan), beskyttet af en delt hemmelighed (`MAILER_SECRET`). `config.php` genereres ved deploy og committes aldrig. Supabase' indbyggede SMTP bruges ikke.
- Live-test: `scripts/e2e-invite.mjs` (to trin; se kommentaren i filen).
