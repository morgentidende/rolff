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
