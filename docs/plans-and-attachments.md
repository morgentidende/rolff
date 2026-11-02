# Planer og vedhæftninger

## Planer (TESTFUNKTION – ingen betaling)
- **Tekst** 49 kr./md.: tekstbeskeder. **Tekst + vedhæftninger** 79 kr./md.: også billeder/screenshots og PDF.
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
