# Grænser pr. person og blokerede ord

## Blokerede ord/udtryk/sætninger (eksisterende, uændret princip)
- Pr. **samtale** (`conversation_blocked_words`), privat liste, højst 50 poster, 2–120 tegn (hævet fra 40, så hele sætninger kan blokeres).
- Matcher enkeltord, udtryk på flere ord og hele sætninger som sammenhængende ordfølge; uafhængigt af store/små bogstaver, accenter (å→a, é→e) og tegnsætning/mellemrum. Æ/Ø bevares som bogstaver men matcher uanset store/små. `*` til sidst = præfiks.
- Princip: beskeden afvises **før levering**, og afsenderen får at vide præcis hvilket ord/udtryk. "Vises ikke eller markeres hos modtager" er i praksis løst ved afvisning.
- Forslag (ikke bygget): en liste pr. person på tværs af samtaler, fx som `person_limits`. Det kræver et tilvalg, så eksisterende samtalelister ikke ændrer betydning.

## Grænser pr. person (`person_limits`)
- Sættes af **modtageren** for én **afsender** og gælder i alle fælles samtaler. Kan ændres når som helst. Gælder kun nye beskeder.
- Længde: `null` = ubegrænset (standard), forudindstillet 140/250, brugerdefineret heltal 80–10.000 (check-constraint, RPC og UI). Beskeder er altid højst 480 tegn, så grænser over 480 virker som ubegrænset; loftet på 10.000 er valgt for at være robust, hvis beskedgrænsen øges.
- Frekvens: `null` = ingen grænse, forudindstillet 1/5/60 min, brugerdefineret 1–1.440 min (24 t). Glidende vindue fra afsenderens seneste **leverede** besked til modtageren i alle fælles samtaler (via `message_deliveries`). Afviste beskeder gemmes ikke og tæller ikke. Vedhæftninger tæller som en besked.
- Flere modtagere: den strengeste grænse gælder; UI siger det.
- Privatliv: RLS: kun modtageren kan læse sine rækker; skrivning kun via `set_person_limit` (kræver fælles aktiv samtale). Afsenderen får kun den bindende grænse via `get_my_send_limits` og fejlsvar.
- Håndhævelse og fejlrækkefølge i `send-message` / `send-attachment`: auth → idempotens → **frekvens** (`frequency_limit` + `retry_after_s`) → **længde** (`length_limit` + `limit`, `count`) → rolle/rate limit (`prepare_send`) → blokering → regler/blokerede ord → AI. Grænserne tjekkes før rate limit og AI, så de koster intet og ikke tæller som forsøg. Læsere får stadig `read_only`. DB-trigger `messages_person_freq` er backstop for frekvens.

## Links i mails og invitationer
- Alle links bygges ét sted: `supabase/functions/_shared/links.ts` (`appUrl()`, `inviteLink()`), fra secret `APP_URL`. Standard (også hvis `APP_URL` mangler eller er ugyldig) er webappen https://yellowgreen-lobster-916967.hostingersite.com/.
- Bruges af invitationsmails (`#invite=<token>`), godkendelsesmails, kontomails (`?auth=…&th=…`), inaktivitetsmail og logoet i mails. Webappen har ingen egne delings-links; FAQ indeholder ingen links.
- Senere app-deep-links: sæt `APP_URL` til et https universal-link-domæne. Der skal ikke ændres kode.

## Tone / dikterende formuleringer
Beskeder der **dikterer** hvad modtageren skal gøre (fx «du skal …» som ordre, «you must …») kan blokeres med `controlling_demand`. Venlige anmodninger, spørgsmål, egen grænsesætning og neutrale citater blokeres ikke alene pga. ordene. Ved AI-/prefilter-blokering kan afsenderen få et **valgfrit** omformuleringsforslag («Brug forslaget»); det sendes ikke automatisk og modereres igen ved gensendelse. Forslag bruges ikke til at omgå ordblokliste, længde- eller frekvensgrænser.
