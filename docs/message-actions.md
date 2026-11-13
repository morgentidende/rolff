# Beskedvisning og handlinger


Et 👍 er et fast svar på en besked, ikke en tekstbesked og ikke et leverings- eller læst-tegn. Kun denne ene emoji kan sættes. Den vises som en lille pille nederst til venstre på boblen (Rolffs farver). Tryk på 👍 igen, eller på pille, fjerner dit eget 👍. Begge parter ser det. Det modereres ikke og kan ikke bære tekst. Læsere og blokerede samtaler (når en anden aktiv deltager har blokeret) kan ikke sætte et nyt 👍; eget 👍 kan stadig fjernes. Ingen notifikation sendes. get_messages_v3 og toggle_message_thumb er den eneste klientadgang; get_messages_v2 er uændret. Udskrift (PDF) medtager antal 👍; den personlige data-ZIP gør det ikke.

Beskedbobler viser kun lokalt klokkeslæt nederst til højre. Langt tryk (500 ms), højreklik eller Enter på en fokuseret boble åbner 👍 øverst, derefter Besvar, Kopiér og Information. Information viser faktisk afsender-email, dato og tid. Slettet bruger eller manglende email vises som utilgængelig. Metadata bevares i den eksisterende eksport.

Besvar vælger et citat over skrivefeltet, som kan annulleres. Intet sendes automatisk. Tekst og svarvalg bevares ved afvisning eller teknisk fejl. Afsendelse gennemgår uændret moderation og øvrige grænser. Kopiér kopierer kun teksten.

Additiv SQL-kontrakt: get_messages_v2 bruger samme medlemskab, modtagervinduer, joined_at og retention som get_messages. message_replies lagrer kun referencen, aldrig en tekstkopi; skjult/slettet/udløbet citatindhold vises ikke. commit_message_reply og commit_attachment_reply er service-only atomiske wrappers om de eksisterende godkendelseskrævende commits. Nye godkendelser bindes til svarreferencen; identiske retries bevares, ændret tekst/reference/filidentitet afvises. Svarmål valideres mod samme samtale og afsenderens læse-/skriveret. Eksisterende RPC'er, metadata og eksport er uændrede.

Loginfri message-actions-fixture.html bruger den samme MessageBubble-komponent og CSS med udelukkende opdigtede data og ingen afsendelse.

Retry identity uses a one-way fingerprint of the random target UUID so deletion can clear the live quote without breaking an identical retry. No quote text or email snapshot is stored. The composer persists only the selected target ID with its existing text draft; controls are locked while a request is pending.
