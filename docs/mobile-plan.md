# Rolff på Android og iOS – status og plan (analyse, intet bygget)

**BESLUTNING (Nicolai, 2026-11-02): Flutter.** Én Dart-kodebase til Android + iOS, adaptive widgets (Material 3 på Android, Cupertino på iOS). Capacitor/Expo er fravalgt; afsnit 4 er bevaret som baggrund.

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

~~Anbefaling: Capacitor~~ – erstattet af Flutter-beslutningen nedenfor.

## 5. Flutter – kompatibilitet
- **Genbruges uændret:** Supabase (Postgres, RLS, RPC'er, migrationer, SQL-tests), Edge Functions (send-message/moderation, delete-account, inactivity-sweep, feedback, invitationer), pg_cron-job, PHP-mailrelay. Klienten taler kun via HTTPS/RPC, så backend er klient-agnostisk.
- **Skal genskrives i Dart:** al UI og klientlogik – login/invitation, chat, modtagetider-UI, blokering/blokerede ord, privatliv/sletning, eksport (CSV/PDF) og "Download mine data", FAQ/politik-visning, samt det, der endnu ikke findes: lokal krypteret lagring, retention lokalt, sky-synk.
- **Små backend-tilpasninger:** push-tokens-tabel + push-afsendelse (FCM/APNs) i en Edge Function; invitationslinks som `https://<domæne>/invite/<token>` (App Links / Universal Links) i stedet for `#invite=`; well-known-filer på domænet.

## 6. Pakker (pub.dev, tjekket 2026-11-02)
| Behov | Pakke | Seneste version / dato |
|---|---|---|
| Supabase auth/RPC/functions | `supabase_flutter` | 2.18.3 / 2026-10-12 |
| Nøgle i Keychain/Keystore | `flutter_secure_storage` | 11.2.0 / 2026-09-16 |
| Lokal DB | `drift` + `sqlite3` (3.x, med SQLCipher-understøttelse) | 2.35.3 / 2026-10-23; 3.8.0 / 2026-10-23 |
| (alternativ) | `sqflite_sqlcipher` | 3.4.1 / 2026-08-04 |
| **Undgå** | `sqlcipher_flutter_libs` | 0.7.0+eol – udfaset ("brug sqlite3 3.x") |
| Kryptografi (AES-GCM, X25519, HKDF) | `cryptography` | 2.9.0 / 2025-11-21 (ældste – vurder vedligehold) |
| Push (FCM; APNs via FCM) | `firebase_messaging` + `flutter_local_notifications` | 17.0.1 / 2026-10-23; 22.3.3 / 2026-10-25 |
| Deep links | `app_links` | 7.2.2 / 2026-10-06 |
| Del/eksport | `share_plus`, `archive` (ZIP), `csv` | 13.3.1; 4.6.0; 8.0.0 |
Firebase (FCM) er gratis, men er en ny underdatabehandler (Google) → privatlivspolitik. Push-indhold altid indholdsfrit.

## 7. AGPL og offentlige moduler
- AGPL-3.0-planen står ved magt. Offentlige moduler bliver: SQL (retention/sletning), Edge Function-moderation (TS) **og** en ny Dart-pakke `rolff_trust` (lokal kryptering, retention-regler, eksport-format) med SPDX-headers.
- Den private Flutter-app importerer `rolff_trust`; Rolff ejer begge, så den private app forbliver privat. Udgives via pub.dev eller git (beslutning senere).
- Krypteringen bliver nu Dart (Keychain/Keystore + SQLCipher/AES-GCM) i stedet for WebCrypto – planens `crypto/`-modul flyttes dertil.

## 8. Web-demoen
Anbefaling: **bevar den nuværende React-web-demo** som test/demo på Hostinger, frosset til feature-paritet med backend, til Flutter-appen er i lukket test; derefter enten Flutter web (samme kode, men tungere og svagere lokal lagring) eller luk den. Slet-/eksportfunktioner skal fortsat findes på web (Google kræver web-link til kontosletning).

## 9. Migrationsplan (ESTIMAT, 1 udvikler + AI, uden butiksgodkendelse)
1. Flutter-skelet, adaptive tema (M3/Cupertino), supabase_flutter-login, invitation via App/Universal Links – ca. 1 uge.
2. Chat + send-pipeline (statusser: blokeret, ord, regler, kan ikke leveres), modtagetider, blokering, blokerede ord – ca. 1–2 uger.
3. Lokal krypteret DB (drift + SQLCipher, nøgle i secure storage), retention lokalt, sletning (lokal + server) – ca. 1–2 uger.
4. Eksport + "Download mine data" (JSON/ZIP-CSV via share), FAQ/politik, feedback – ca. 1 uge.
5. Push (FCM/APNs, indholdsfrit) + backend push-token – ca. 1 uge.
6. Butiksforberedelse: vilkår, kontaktinfo, rapportering (beslutning), App Privacy/Data safety, TestFlight/lukket test – ca. 1–2 uger + reviewtid.
I alt groft 6–9 uger. Usikkert estimat.

## 10. Risici
- **Rapportering kræves af Apple 1.2 og Google UGC** – konflikt med "ingen rapportér-knap" (se afsnit 3). Største afvisningsrisiko.
- Betalte konti (Apple Developer, Google Play) kræver godkendelse.
- Dobbelt vedligehold (React-web + Flutter) i overgangen.
- Lokal kryptering + "bevis-kopi": tab af telefon = tab af lokal kopi, medmindre sky-synk er slået til.
- iOS-push kræver APNs-nøgle (Apple-konto) og Firebase-projekt.
- `cryptography`-pakken har ældste release; alternativ: platformens native krypto via SQLCipher alene.

## 11. Groft trin-for-trin (oprindelig, Capacitor – udgået)
1. PWA-basis: service worker (offline-skal, cache), web-push opt-in (Android/desktop + iOS-hjemmeskærm).
2. Lokal krypteret lagring bag et interface (`LocalStore`): web = IndexedDB + WebCrypto; native = SQLite + nøgle i Keychain/Keystore.
3. Capacitor: `npx cap add android ios`; plugins: push, secure storage, SQLite, share, app links.
4. Deep links: `assetlinks.json` + `apple-app-site-association` på domænet; invitationslink `https://…/invite/<token>` i stedet for `#invite`.
5. Push: FCM (Android) + APNs (iOS) via Supabase Edge Function; indholdsfri notifikation ("Du har nye beskeder i Rolff").
6. Butikskrav: brugsvilkår + accept, kontaktinfo i appen, beslutning om rapportering, privatlivspolitik-URL, App Privacy/Data safety.
7. Konti (betalt – kræver godkendelse), intern test (TestFlight / lukket test i Play), indsendelse.
