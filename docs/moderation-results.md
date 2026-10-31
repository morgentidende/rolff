# Moderationsresultater (observeret, ingen garanti)

Kørsel 2026-11-01 00:30 (dansk tid), model `gemini-3.5-flash-lite` (gratis niveau, temperatur 0, struktureret JSON), uden samtalekontekst.

| Total | Korrekt | Fejlblokeret (tilladt besked afvist) | Gennemsluppet (sårende tilladt) | Tekniske fejl |
|---|---|---|---|---|
| 57 | 57 | 0 | 0 | 0 |

Korpus: 7 eksempler fra specifikationen, 32 ironi/sarkasme/falsk høflighed/skjult hån/afpresning (DA+EN), 2 prompt-injektioner, 16 tilladte saglige (DA+EN). Fulde svar: `tests/moderation/results-gemini-3.5-flash-lite.json`.

Forbehold:
- Korpusset er skrevet af udvikleren og er sandsynligvis lettere end virkelige beskeder. 100 % her betyder ikke fejlfri moderation.
- Ikke testet endnu: vurdering med samtalekontekst, gentagne kørsler (stabilitet), meget subtile tilfælde, slang/stavefejl, og `gemini-3.8-flash` som alternativ.
- Kendte risici: falsk-positive ved skarp men saglig kritik; falsk-negative ved meget subtil ironi.

## Live end-to-end (2026-11-01 ca. 00:55 dansk tid, projekt dubwlbqazbllnwpsqrjv)
`scripts/e2e-live.mjs` mod deployet backend med to syntetiske konti: **19/19 bestået** – login A/B, ens fejl ved forkert/ukendt login, høflig besked accepteret, dansk ironi og falsk høflighed afvist (sarcasm_or_irony / false_politeness), retry uden dublet, ingen statusfelter, besked uden for modtagetid ikke synlig via RPC/tabel-API, "Modtag nu" frigiver, anonym/uden login afvist.
Fundne og rettede fejl undervejs: Edge Functions brugte legacy-nøglevariabler (rettet til at understøtte nye nøgler); nye Supabase-projekter giver ikke automatisk tabeladgang (eksplicitte grants i ny migration).
