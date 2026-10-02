# Coco Live mobile (Flutter)

Android-first Flutter app for farmers, FPOs, traders and buyers in the Pollachi belt ([ADR-009](../../docs/decisions/009-nextjs-nestjs-flutter.md)). Tamil is the default language, English is one tap away. It talks only to the existing `/v1` API ([endpoints](../../docs/api/endpoints.md), [conventions](../../docs/api/conventions.md)); no API changes were needed.

## What it does

| Area | Screens | API |
|---|---|---|
| Price board (no sign-in) | Prices: low / reference / high per unit, freshness and confidence in words, evidence counts, limited-evidence and stale notes, the "reference prices are not offers" disclaimer, MSP as a separate policy reference. Evidence: contributor-anonymous observations behind a range. | `GET /v1/prices/latest`, `/v1/prices/evidence`, `/v1/prices/msp`, `/v1/catalog` |
| Sign-in | Phone number → 6-digit OTP. Sign out (this device) and sign out on all devices. | `POST /v1/auth/otp/request`, `/v1/auth/otp/verify`, `GET /v1/me`, `PATCH /v1/me` (language), `POST /v1/me/sessions/revoke-all` |
| Price alerts | Create from a price card with direction, threshold, channel and an explicit consent checkbox (unticked by default; save stays disabled until ticked). List, pause, resume, cancel. | `/v1/alerts` |
| Market | Active lots with cursor paging; make an offer (quantity, price, validity, payment, weighment). | `GET /v1/sell-lots`, `POST /v1/offers` |
| Sell & buy | My lots: create (product-specific grade attribute, unit, quantity, window, costs included/excluded, price or "invite offers"), add a photo (upload intent + signed PUT), publish, withdraw. Buy requirements: create one-off or recurring, matches, close. | `/v1/sell-lots`, `/v1/me/sell-lots`, `/v1/uploads/intents`, `/v1/buy-requirements[/recurring]`, `/v1/me/buy-requirements` |
| Deals | Offers grouped into negotiation threads (every revision), accept / counter / reject / withdraw. Deals list and deal card: latest card revision, milestones (agreed → picked up → delivered → accepted → paid → completed), role-based actions, amendment response, timeline. | `/v1/offers…`, `/v1/deals…` |

Organisations, verification claims, partner and operator work stay in the web app.

## Run

Prerequisites: Flutter stable (3.35 or newer; developed with 3.47), Android SDK and an emulator or device.

```text
# from the repository root: start the API (OTPs print to its console in development)
OPERATOR_PHONES=+919000000001 npm run dev

cd apps/mobile
flutter pub get
flutter run                                   # emulator: uses http://10.0.2.2:4000
flutter run --dart-define=API_BASE_URL=http://192.168.1.20:4000   # a phone on the same Wi-Fi
flutter build apk --release --dart-define=API_BASE_URL=https://api.example.in
```

`API_BASE_URL` is read at build time (`lib/config.dart`). The default `http://10.0.2.2:4000` is the host machine as seen from the Android emulator. Debug builds allow cleartext HTTP for that (`android/app/src/debug/AndroidManifest.xml`); release builds only allow HTTPS.

## Test

```text
flutter analyze
flutter test
```

- `test/api_client_test.dart`: the API client against a mock `http` client (headers, idempotency keys, bearer token, problem+json, 401 handling, offline, paging, model parsing).
- `test/format_test.dart`: INR from paise (Indian grouping, Tamil and English), rupee input parsing, IST dates, Tamil/English catalog parity.
- `test/price_board_test.dart`, `test/sign_in_test.dart`, `test/alert_consent_test.dart`: widget tests for the price board, evidence, language switch, OTP sign-in/sign-out and alert consent.
- `test/live_api_test.dart`: opt-in contract run of the full flow (sign-in, alerts, lot, requirement, offer → counter → accept, every deal milestone) against a freshly started in-memory API; skipped unless `LIVE_API_URL` and `LIVE_API_LOG` are set (see the file header).

CI runs `flutter pub get`, `flutter analyze` and `flutter test` in the `mobile` job of `.github/workflows/ci.yml`.

## Architecture

```text
lib/
  main.dart            wiring: ApiClient + SecureTokenStore + AppState
  config.dart          API_BASE_URL (--dart-define)
  app.dart             MaterialApp (Material 3, 48 dp touch targets), bottom-navigation shell
  api/
    api_client.dart    every /v1 call used by the app; headers, idempotency, errors
    problem.dart       ApiProblem (problem+json, localised `message`)
    token_store.dart   SecureTokenStore (Android Keystore via flutter_secure_storage), MemoryTokenStore
  models/              lenient JSON models: catalog, prices, lots, requirements, offers, deals
  state/app_state.dart language, catalog and signed-in user (ChangeNotifier + InheritedNotifier)
  l10n/strings.dart    Tamil-first UI catalog (keys follow the web catalog)
  util/format.dart     INR from paise, rupee parsing, quantities, IST dates
  screens/             one file per screen
  widgets/common.dart  loading/error views, notes, dropdowns, date field, validators
```

Conventions the client follows:

- **Language.** Every request sends `Accept-Language` and `?lang=` with the UI language, so problem `message`s come back in Tamil or English. A signed-in user's language choice is saved with `PATCH /v1/me`.
- **Errors.** Failures become `ApiProblem`; screens show its `message` (plus field names for validation failures) and never branch on translated text. A 401 on an authenticated call clears the stored token and returns the app to the signed-out state.
- **Idempotency.** Every mutation sends an `Idempotency-Key`. Forms keep one key per submission until it succeeds, so a retry after a dropped connection repeats the same request; accepting an offer uses `accept-<offerId>`. Counter-offers and acceptances also send `If-Match` with the offer version.
- **Money and quantities.** Amounts are integer paise on the wire and formatted as INR with Indian grouping; typed rupee amounts are parsed exactly (no floating point). Quantities stay decimal strings.
- **Session.** The bearer token lives only in the platform keystore (`flutter_secure_storage`, encrypted shared preferences); `android:allowBackup` is off. Signing out deletes it; "sign out on all devices" also revokes every server session.
- **Accessibility.** Material 3, buttons at least 48 dp, freshness and confidence as words (not colour alone), range values with semantic labels.

## Known gaps

- Not yet built on a device in CI: the CI job analyses and tests; an APK build needs the Android SDK.
- Tamil copy is a first draft (shared with the web catalog) and needs review by a native speaker.
- No offline cache of the price board, no push notifications (the `PUSH` alert channel is stored but nothing on the device receives it yet), no deep links.
- Not covered in the app: organisations and verification claims, inspections, transport, disputes, settlements, partner and operator consoles (web only).
- Dates are chosen by day; times default to the current time of day.
