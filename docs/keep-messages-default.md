# Beskeder beholdes som standard (2026-11-28)

Besluttet: gamle beskeder beholdes, indtil brugeren selv sletter dem eller sin konto. Der er ingen automatisk sletning som standard
og ingen sletning på grund af inaktivitet (fjernet 2026-11-26).

## Hvad ændres
- `user_privacy.retention` har nu standard `'unlimited'` (vist som “Indtil jeg sletter dem (standard)”). `1y` og `5y` er stadig valgfri.
- `_retention_cutoff()` behandler en bruger uden række som `unlimited` (var `1y`). Klientens lokale cache bruger samme standard.
- `retention_sweep()` er uændret: en besked slettes først fysisk, når den er ældre end ALLE aktive medlemmers egen grænse.
  Med `unlimited` som standard beskytter et medlem uden kortere valg beskeden for evigt. (Samtaler, hvor alle har forladt dem, har
  ingen medlemmer at beskytte dem og ryddes efter 1 år, som før.)
- Advarsel 3 dage før (mail + push) til brugere med kortere valg, én gang pr. omgang (30 dages pause; nyt valg starter en ny omgang).

## Eksisterende brugere (migrationen rører dem IKKE)
Der er intet, der skelner “aldrig rørt, står på 1y fra gamle standard” fra “valgte selv 1y”: der er ingen `created_at`, ingen
valghistorik, og `updated_at` ændres også af synk-indstillinger og migrationer. Derfor ændrer migrationen ingen eksisterende række.
Valgmuligheder (beslutning hos Nicolai/forælder):
- **A.** Flyt alle nuværende `1y` til `unlimited` én gang (se `docs/keep-messages-existing-users.sql`, ikke kørt). Kun 1y-rækker.
  Rammer også dem, der selv valgte 1y. Fordel: ingen risiko for at miste beskeder; ulempe: tilsidesætter et evt. aktivt valg.
- **B.** Lad dem stå. De får advarslen (mail + push) 3 dage før deres første beskeder forsvinder og kan vælge frit. Ingen beskeder
  kan forsvinde før tidligst 1 år efter den første besked.
- **C.** Som A, men kun brugere hvor `retention='1y'` OG `updated_at` = første gang rækken blev oprettet (rækker aldrig rørt siden
  oprettelsen). Upræcist (rækken kan være oprettet af sync-indstilling), så ikke anbefalet uden at kende data.
