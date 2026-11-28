# Rolff

Rolig, saglig chat for mennesker i konflikt – fx skilsmisse, arvesager, ekskærester, venskaber og retssager. Beskeder vurderes semantisk (inkl. ironi, sarkasme og falsk høflighed) på serveren **før** afsendelse, og modtageren styrer selv, hvornår nye beskeder bliver tilgængelige.

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
- Invitationstokens gemmes kun som SHA-256; fejl er generiske. Ekstra deltagere (læse eller læse/skrive) kræver samtykke fra alle aktive deltagere, bundet til rolle og `member_version`. Databasens rolle `parent` betyder teknisk "hoveddeltager" (navnet er bevaret for at undgå en risikabel omdøbning); UI siger aldrig forælder.
- Ingen beskedtekst i logs. Service-role-nøglen findes kun i Edge Functions.
- Ikke ende-til-ende-krypteret: klartekst ligger i Postgres (krypteret at rest hos Supabase) og sendes til AI-udbyderen ved vurdering.

## Kontaktvælger ved invitation
Knappen “Vælg fra kontakter” / “Choose from contacts” vises ved e-mail-feltet på både “Invitér til Rolff” og “Invitér person til denne samtale”, men kun når en kontaktvælger er tilgængelig. I webappen er det Contact Picker API (`navigator.contacts.select(['email'], { multiple: false })`), som i dag findes i Android Chrome. På iPhone i browseren er knappen skjult, og man skriver e-mailen selv.

UI'en taler kun med interfacet `ContactEmailPicker` i `apps/web/src/native/contactPicker.ts`. Den åbner telefonens egen vælger for **én** kontakt, tager kun e-mailen (har kontakten flere, vælger brugeren en), og skriver den i feltet. Appen beder aldrig om adgang til hele kontaktlisten og gemmer eller sender ikke valget noget sted.

Når Rolff udgives som rigtig app, registreres en native adapter i samme stik: på iPhone `CNContactPickerViewController` (kun e-mail), på Android systemets kontaktvælger. Det kan være Flutter (den planlagte app) eller et Capacitor-plugin — UI'en skal ikke ændres. Se også `docs/native-readiness.md`.

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
- Mail sendes med godkendt SMTP (`smtp.hostinger.com:465`, TLS) direkte fra Edge-funktionerne (`_shared/smtp.ts`), fra `rolff-no-reply@nicolaipetersen.dk` med afsendernavnet "Rolff", når Supabase-hemmelighederne `SMTP_USER` og `SMTP_PASS` er sat (valgfrit `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`). Ellers bruges den gamle relay `apps/web/public/api/mail.php` (PHP `mail()`, beskyttet af `MAILER_SECRET`; `config.php` genereres ved deploy og committes aldrig). Hostingersite.com-domænet har ingen SPF/DKIM, så Gmail afviser relay-mails.
- Hver afsendelse logges i `mail_log` (kun server): status, udbyderens svarkode, kort fejlårsag (fx `rcpt:550`), type og en nøglet hash af modtageren. Aldrig indhold eller adresse.
- Fejler en invitationsmail, bliver invitationen stående (markeret), så forælderen kan trykke "Send igen" eller "Kopiér invitationslink" (nyt link, gammelt link dør; højst 1 pr. 30 s og 10 pr. døgn pr. invitation). Udløbne invitationer vises som "Udløbet" i 30 dage og kan fornys eller fjernes.
- Live-test: `scripts/e2e-invite.mjs` (to trin; se kommentaren i filen).
