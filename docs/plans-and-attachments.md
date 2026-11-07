# Planer og vedhæftninger

## Planer (TESTFUNKTION – ingen betaling)
- **Tekst** 49 kr./md.: tekstbeskeder på højst 160 tegn. **Tekst + vedhæftninger** 79 kr./md.: højst 480 tegn og også billeder/screenshots og PDF.
- **Plan pr. bruger**, ikke pr. samtale: planen er afsenderens evne. To forældre kan have hver sin plan. At *sende* en vedhæftning kræver, at **afsenderen** har 79-planen; alle medlemmer (også læsere) kan altid *se* modtagne vedhæftninger.
- Regel: opgradering gælder straks (ny periode starter). Nedgradering planlægges til periodens slut (`pending_plan`); indtil da beholdes vedhæftninger. Vælg nuværende plan = annullér planlagt skift. "Skift straks" ved nedgradering findes kun som testfunktion.
- **Ekstra deltagere:** at invitere en ekstra person (ud over de to forældre) kræver, at **den inviterende** har 79-planen – tjekket i `create_member_invitation` (DB, `plan_required`) og i `invite-email` (HTTP 402). Andre deltagere og den inviterede må være på 49 og kan acceptere/deltage normalt. Den første modpart (oprettelse af samtalen, `create_invitation`) er tilladt på 49. Nedgradering fjerner ingen eksisterende deltagere.
- Håndhævelse: `send-attachment` (402 `plan_required`) og igen i databasen i `commit_attachment_message` (`plan_required`).
- Feature-flag: `app_flags.plan_test_switch`. `user_plans.source` er låst til `'test'`; rigtig betaling skal tilføje en ny kilde (fx `stripe`) og sætte planen fra en verificeret webhook, ikke fra klienten.

### Mangler før rigtig betaling (kræver Nicolais godkendelse)
Stripe-konto + Checkout/Billing + webhook; Apple IAP / Google Play Billing for køb i mobilappene (digitale abonnementer i apps skal som udgangspunkt gennem butikkernes betaling); moms (25 %), fakturaer/kvitteringer; abonnementsvilkår; 14 dages fortrydelsesret og samtykke til straks-levering; nem opsigelse; prisvisning inkl. moms; hvem betaler i en samtale (nu: hver afsender selv); prøveperiode (findes ikke); white-label/foreningsrabat (findes ikke).

## Vedhæftninger
- Typer: PNG, JPG, WebP, GIF (ikke animeret), PDF. Højst 4 MB, PDF højst 5 sider, ingen krypterede PDF'er. Typen afgøres af magic bytes på serveren.
- Pipeline (`send-attachment`): auth → medlemskab/rolle/rate (`prepare_send`) → plan → filtjek → regler på billedtekst → OpenAI Responses API (`input_image` / `input_file`, `store:false`) med samme regler + `inappropriate_image` → modtagerens blokerede ord og hårdt forfilter på den aflæste tekst → engangsgodkendelse bundet til sha256(tekst + sha256(fil)) → atomisk lagring.
- Intet gemmes eller leveres før godkendelse. Fail closed. Ingen filindhold/tekst i logs (kun type, sider, ms, tokens, afgørelse).
- Lagring: `message_attachments` (bytea) ved siden af beskeden, så opbevaring, sletning, kontosletning (modtagere beholder kopi) og kaskader virker uændret. Ingen RLS-policies; kun `get_attachment` (samme synlighed som `get_messages`).
- Rate limit: 10 forsøg/min (fælles med beskeder) og 20 vedhæftninger/døgn pr. afsender.


## Skrivefelt, kamera og tegnkvoter
- 160/480 er produktets SMS-længder, talt i Unicode-kodepunkter (samme som PostgreSQL char_length), ikke GSM/UCS-2 transportsegmenter. Ingen stille afkortning. En strengere modtagergrænse vinder altid.
- Den autoritative message_char_limit kalder _effective_plan. Edge afviser overgrænsen før AI, prepare_send gentjekker, og en BEFORE INSERT-trigger beskytter både gamle og nye commit-RPC'er mod planskift under AI. Eksisterende beskeder/identiske retries ændres ikke ved nedgradering.
- På 79 kan billedtekst være op til 480 tegn; alt-tekst/kontekstuddrag beholder 300. Uden billedtekst tæller filnavn-fallback ikke som brugerens billedtekst i persongrænsen.
- Papirclips og kamera vises også på 49. Tryk viser et venligt tilbud om 79, ikke en filvælger, tilladelsesdialog, automatisk opgradering eller betaling.
- Aktuel klient er web/PWA, ikke en bygget Flutter-app. Filvalg bruger systemets vælger, som kun udleverer valgte filer, ikke hele arkivet. Kameravalg bruger input[type=file] accept=image/* capture=environment: telefon/browser styrer tilladelse, kan tilbyde en fallback og kan huske tidligere valg. Desktop garanterer ikke et kamera. Ved afvisning/annullering sendes intet; papirclipsen er alternativet. Ingen tilladelse anmodes ved login.
- Til den senere native Flutter-klient skal kamera-/fototilladelser og afvisning genprøves på rigtige iOS/Android-enheder med passende platformbeskrivelser. Der er endnu ingen native manifests i repoet; webtesten dokumenterer ikke native tilladelser.
- Tekstfeltet har ingen manuel resize, starter med én linje, vokser/shrinker til 180 px og scroller derefter indvendigt. Papirflyet står til højre for feltet; filvalg sender aldrig automatisk.
