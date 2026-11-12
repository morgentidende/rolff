# ROLFF som app i App Store og Google Play – status

ROLFF er stadig en webapp. Intet er pakket ind som app endnu. Denne side viser, hvad der er gjort klar i koden, og hvad der mangler, før ROLFF kan lægges i butikkerne.

## Gjort klar i koden

- **Tilladelser.** Kamera, billeder/filer og notifikationer bliver først efterspurgt, når brugeren selv trykker på knappen. Før telefonens eget spørgsmål forklarer ROLFF kort hvorfor, på dansk og engelsk. Har brugeren sagt nej, spørger ROLFF ikke igen. I stedet vises en vejledning i, hvordan man slår det til i telefonens indstillinger (`src/native/permissions.ts`, `PermissionDialog.tsx`).
- **Notifikationer.** Der er ét fælles lag til push (`src/native/push/`). I dag bruges web push (PR54, nu live). Når ROLFF bliver pakket ind, kan FCM (Android) og APNs (iPhone) sættes i samme stik. Tokens gemmes med platform (`ios`/`android`) i tabellen `push_device_tokens`. Migrationen `20261112220000_push_device_tokens.sql` ligger i repoet, men er **ikke kørt** i produktion.
- **Skærmkanter.** Der tages højde for notch og hjemmebjælke (`viewport-fit=cover` og safe-area i `src/native.css`).
- **Tilbage-knappen på Android.** Den lukker det øverste vindue, og på forsiden lægger den ROLFF i baggrunden i stedet for at lukke den (`src/native/backButton.ts`).
- **Invitationslinks.** Links fungerer også, mens ROLFF er åben. Det gælder både den nuværende `…/#invite=KODE`, `…/invite/KODE` og `rolff://invite/KODE`. Det samme gælder links til nulstilling af adgangskode og skift af e-mail (`src/native/deepLinks.ts`).
- **Ingen popups.** ROLFF bruger ikke `window.open`, `alert`, `confirm` eller `prompt`, og en test sikrer, at det bliver ved med at være sådan. PDF-vedhæftninger får knapperne "Åbn PDF" og "Gem PDF". Eksterne links åbner i telefonens browser, når ROLFF kører som app (`src/native/externalLinks.ts`).
- **"Tilføj til hjemmeskærm"** vises ikke inde i en app.

Alt det native slår først til, når appen er pakket ind (`window.Capacitor`). På nettet ændrer det ingenting.

## Det, der mangler, før butikkerne

1. **Udviklerkonti.** Apple Developer Program koster 99 USD om året. Google Play koster 25 USD én gang. Vælger I en firmakonto, skal I bruge et D-U-N-S-nummer (gratis, men det tager nogle dage). En ny personlig Google-konto skal først have 12 testere i 14 dage, før appen må udgives.
2. **Apple regel 4.2 (minimumsfunktionalitet).** Apple afviser apps, der bare er en hjemmeside i en ramme. ROLFF skal derfor have rigtige app-funktioner med fra start: push via APNs, kamera og deep links. Det er gjort klar, men skal bygges ind i selve app-pakken.
3. **Betaling for 49/79-planerne.** Digitale abonnementer inde i appen skal som udgangspunkt købes via Apple In-App Purchase og Google Play Billing. Butikkerne tager 15–30 %. Planerne skal oprettes i begge butikker, og serveren skal kunne godkende kvitteringerne. Alternativet er links til betaling på nettet, men det er kun tilladt i visse lande og med særlige regler.
4. **Sign in with Apple.** Det er kun nødvendigt, hvis der kommer login med Google eller andre sociale logins. Med kun e-mail og adgangskode, som i dag, er det ikke et krav.
5. **Privatlivsformularer.** Apple kræver "App Privacy" (privatlivsetiketten) og et privacy manifest. Google kræver formularen "Data safety". Begge skal passe med privatlivspolitikken, som stadig er et UDKAST.
6. **Demokonto til gennemgang.** Apple og Google skal have en testkonto og en modpart at skrive med. Bemærk: deres test sender rigtige beskeder gennem AI-tjekket. Det kræver, at EU/ZDR-aftalen er på plads først.
7. **Push-nøgler.** Push kræver en APNs-nøgle fra Apple og et Firebase-projekt til Android. De skal opbevares som hemmeligheder og aldrig ligge i koden.
8. **Universal Links / App Links.** Filerne `/.well-known/apple-app-site-association` og `/.well-known/assetlinks.json` skal ligge på domænet. Det kræver Apple Team ID og app-signaturens SHA-256. Det bør være ROLFF's eget domæne, ikke hostingersite.com.
9. **Tekster til tilladelser i app-pakken.** iPhone skal bruge `NSCameraUsageDescription` og `NSPhotoLibraryUsageDescription` på dansk og engelsk (genbrug teksterne fra `permissions.ts`). Android skal have `CAMERA` og `POST_NOTIFICATIONS`.
10. **Butikssider.** Der skal laves skærmbilleder, en beskrivelse (da/en), en aldersgrænse, en support-URL og en kontakt-e-mail. Sletning af konto inde i appen er allerede på plads, og det er et krav i begge butikker.
11. **Ikke afprøvet.** Intet er endnu testet på en rigtig iPhone eller Android-telefon som app.
