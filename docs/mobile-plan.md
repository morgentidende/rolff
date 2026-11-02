# Rolff på Android og iOS – status og plan (analyse, intet bygget)

Dato: 2026-11-02. Status: UDKAST til beslutning (Nicolai).

## 1. Hvad er bygget i dag
- **Kun web.** Vite 7 + React 19 + TypeScript (`apps/web`), Supabase (Postgres + Edge Functions i Deno, Frankfurt), statisk hosting på Hostinger (PHP-mailrelay i `dist/api`).
- Web-manifest + ikoner findes (kan "føjes til hjemmeskærm"), men **ingen service worker** → ingen offline, ingen web-push, ingen installérbar PWA i fuld forstand.
- Ingen native kode, ingen Capacitor/Expo/React Native.

## 2. Status pr. platform
| Område | Web (i dag) | Android | iOS |
|---|---|---|---|
| Chat, moderation, modtagetider, invitationer, blokering, sletning, feedback | Virker (server-håndhævet) | Virker i Chrome (mobilweb) | Virker i Safari (mobilweb) |
| Lokal kryptering | Ikke bygget (plan: IndexedDB + WebCrypto, ikke-eksporterbar nøgle) | Native: Android Keystore | Native: iOS Keychain/Secure Enclave. Bemærk: Safari kan rydde webdata (ITP) → web-kopi er ikke en pålidelig "bevis-kopi" på iOS |
| Push-notifikationer | Ingen (kun mail). Web-push kræver service worker | Web-push i Chrome mulig; native: FCM | Web-push kun for web-app føjet til hjemmeskærm (iOS 16.4+); native: APNs |
| Offline / modtagetider | Online-only. Modtagetider håndhæves på serveren (virker uden app) | Kræver lokal DB (SQLite) for offline læsning | Samme |
| Eksport / "Download mine data" | Samtale-eksport CSV/PDF findes; art. 15-udtræk ikke bygget | Fil-download skal via share-sheet (native) | Samme; Safari-download virker, men share-sheet er bedre |
| Login / invitationslinks | E-mail + adgangskode; invitationslink `/#invite=…` | Kræver **App Links** (`/.well-known/assetlinks.json` på domænet) | Kræver **Universal Links** (`/.well-known/apple-app-site-association`) |
| Kontosletning i appen | Bygget (⋮ → Privatliv og sletning) | Krav i Google Play (i app + web-link) – opfyldt i princippet | Krav i Apple 5.1.1(v) – opfyldt i princippet |

## 3. App store-krav (verificeret 2026-11-02)
- **Apple App Review Guidelines 1.2 (UGC)** kræver: filtrering af stødende indhold (✔ AI + regler), **mekanisme til at rapportere stødende indhold med hurtig respons** (✘ – Nicolai har besluttet "ingen rapportér-knap"), mulighed for at **blokere misbrugende brugere** (✔ samtaleblokering), og **publiceret kontaktinfo** (✘ mangler i appen). Kilde: https://developer.apple.com/app-store/review/guidelines/#user-generated-content
- **Apple 5.1.1(v):** apps med kontooprettelse skal tilbyde kontosletning i appen (✔).
- **Apple 4.2 Minimum Functionality:** en ren "pakket hjemmeside" kan afvises → en Capacitor-app skal have native værdi (push, sikker lagring, share-sheet).
- **Google Play UGC-politik** kræver accept af brugsvilkår før UGC (✘ mangler vilkår), **in-app rapportering af indhold og brugere** når brugere er identificerede (✘), og **blokering ved 1:1-chat** (✔). Kilde: https://support.google.com/googleplay/android-developer/answer/9876937
- **Privatlivserklæringer:** Apple "App Privacy"-labels og Google Play "Data safety"-formular skal udfyldes (e-mail, beskeder, bruger-id; deling med AI-underdatabehandler). Kræver at privatlivspolitikken er offentlig (URL).
- **Konti:** Apple Developer Program (årligt gebyr) og Google Play Console (engangsgebyr) – **betalte tjenester → kræver Nicolais godkendelse** (reglen "ingen betalte tjenester"). Nye personlige Google-konti skal køre lukket test med testere før produktion (tjek aktuelle krav ved oprettelse).

**Konflikt der kræver beslutning:** "Ingen rapportér-knap / ingen overvågning" vs. Apple 1.2 og Google UGC. Mulig løsning uden indholdsovervågning: en "Rapportér"-handling, der kun sender det, brugeren *selv* vælger at indsende (fx den konkrete besked + kategori) til kontakt-adressen, med svar inden for fx 24 timer – ingen automatisk logning. Det er en ændring af en truffen beslutning, så den er IKKE bygget.

## 4. Vejvalg
| Vej | Fordele | Ulemper |
|---|---|---|
| **PWA** (service worker + manifest) | Hurtigst, ét kodegrundlag, ingen butiksgebyrer | Ingen App Store/Play-tilstedeværelse; iOS-push kun fra hjemmeskærm; iOS kan rydde lokale data → svag lokal "bevis-kopi" |
| **Capacitor** (pakker eksisterende React-app) | Genbruger ~100 % af UI og logik; native plugins: push (FCM/APNs), secure storage (Keychain/Keystore), SQLite, share, deep links | Risiko for 4.2-afvisning hvis for "web-agtig"; WebView-ydelse |
| **Expo / React Native** | Mest native følelse; Expo SecureStore, expo-notifications, EAS build | UI skal omskrives (React DOM → RN); kun TS-logik/API-lag genbruges; længst tid |

**Anbefaling: Capacitor**, efter at web-appen er gjort til en rigtig PWA. Hurtigste vej til begge butikker med ét kodegrundlag; native plugins dækker kryptering, push og deep links.

## 5. Groft trin-for-trin
1. PWA-basis: service worker (offline-skal, cache), web-push opt-in (Android/desktop + iOS-hjemmeskærm).
2. Lokal krypteret lagring bag et interface (`LocalStore`): web = IndexedDB + WebCrypto; native = SQLite + nøgle i Keychain/Keystore.
3. Capacitor: `npx cap add android ios`; plugins: push, secure storage, SQLite, share, app links.
4. Deep links: `assetlinks.json` + `apple-app-site-association` på domænet; invitationslink `https://…/invite/<token>` i stedet for `#invite`.
5. Push: FCM (Android) + APNs (iOS) via Supabase Edge Function; indholdsfri notifikation ("Du har nye beskeder i Rolff").
6. Butikskrav: brugsvilkår + accept, kontaktinfo i appen, beslutning om rapportering, privatlivspolitik-URL, App Privacy/Data safety.
7. Konti (betalt – kræver godkendelse), intern test (TestFlight / lukket test i Play), indsendelse.
