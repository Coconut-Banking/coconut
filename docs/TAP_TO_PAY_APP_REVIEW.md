# Tap to Pay on iPhone — App Review Submission

Apple granted the Tap to Pay entitlement (Case-ID: 18856933) with **development distribution restriction** (registered test devices only). This doc is aligned with the **App Review Requirements Checklist (March 2026 v1.6)** so the checklist is passable.

**Apple’s Box folder:** https://apple.box.com/v/ttpoirequirements  
- Tap to Pay on iPhone App Requirements and Review  
- App Review Requirements Checklist  

**Submit:** Reply to Apple’s email (include `Case-ID: 18856933`), then upload: **New User Flow** video, **Existing User Flow** video, **Checkout Flow** video, and the **completed** checklist (both tabs filled).

**Filled checklist (copy into Apple’s form):** See **`docs/TAP_TO_PAY_CHECKLIST_FILLED.md`** for every field pre-filled and Status/Comments for each requirement. Replace `[FILL]` with your Team ID, submission date, and device count.

---

## Checklist Tab 1: Instructions

| Field | Value (replace [FILL] before submit) |
|-------|--------------------------------------|
| **Team ID** | [FILL] — developer.apple.com/account → Membership |
| **App Name** | Coconut |
| **PSP Name** | Stripe |
| **Date** | [FILL] — e.g. 2026-03-14 |
| **Version** | 1.0.0 |
| **Existing or New app** | New app |
| **Distribution type** | Unlisted |
| **Number of Devices** | [FILL] — registered test device count |

Instructions: (1) Complete both tabs, (2) Attach file to your email to Apple.

---

## Pre-flight: Backend and device (before building flows)

### Backend (this repo — coconut web)

| Check | How |
|-------|-----|
| Terminal APIs | Deploy has `POST /api/stripe/terminal/connection-token`, `GET /api/stripe/terminal/location`, `POST /api/stripe/terminal/create-payment-intent`. |
| Webhook | Stripe Dashboard → Webhooks → add **`payment_intent.succeeded`**. |
| Env | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` in production. |
| Auth | Signed-in users get 200 from `/api/stripe/terminal/*`. |

See `docs/STRIPE_TERMINAL_SETUP.md`.

### Mobile app (coconut-app)

| Check | How |
|-------|-----|
| API URL | `EXPO_PUBLIC_API_URL` = deployed coconut web URL. |
| Entitlement | `com.apple.developer.proximity-reader.payment.acceptance` in app config. |
| Build | Development build, **physical** iPhone (Tap to Pay not in Simulator). |
| Device | iPhone XS or later, NFC on, registered test device. |

---

## Official requirements → implementation (passable checklist)

Use this to implement and to mark the official checklist. **Demo** column = which recording to use.

### 1. General Requirements

| ID | Type | Requirement | How to demonstrate | Implement in |
|----|------|-------------|---------------------|---------------|
| 1.1 | Required | Support Tap to Pay on iPhone XS and later | Checklist | coconut-app: device check / Stripe SDK |
| 1.2 | Conditional | If TTP is primary payment method: set iOS Deployment Target per PSP docs | Checklist | coconut-app: Xcode deployment target |
| 1.3 | Conditional | If TTP is primary: require A12 + UIRequiredDeviceCapabilities | Checklist | coconut-app: Info.plist / config |
| 1.4 | Required | For iOS &lt; 17.6: handle `PaymentCardReaderError.osVersionNotSupported` with message to update iOS | — | coconut-app: catch error, show “Update to latest iOS” |
| 1.5 | Required | At launch or foreground: trigger preparation/warm-up of Tap to Pay (see PSP SDK) | Checklist | coconut-app: warm-up reader on app launch/foreground |
| 1.6 | Required | Merchant T&amp;C acceptance status from **Apple** (not local variable); see PSP SDK | Checklist | coconut-app: use Stripe Terminal SDK API for Apple T&amp;C status |
| 1.7 | Recommended | Face ID / Touch ID for login (public App Store) | — | coconut-app: if applicable |
| 1.8 | Conditional | Public App Store: Human Interface Guidelines | — | When going public |
| 1.9 | Conditional | Public App Store: Tap to Pay Marketing Guidelines | — | When going public |

### 2. Onboarding Merchants

| ID | Type | Requirement | How to demonstrate | Implement in |
|----|------|-------------|---------------------|---------------|
| 2.1 | Required | New user easily discovers account creation and accessing Tap to Pay | **New User Flow Recording** | coconut-app: clear path sign-up → TTP |
| 2.2 | Required | Fully digital onboarding within app, completed on iPhone | **New User Flow Recording** | coconut-app: no external-only onboarding |
| 2.3 | Required | For most users, onboarding &lt; 15 min to first Tap to Pay payment (per local regulations) | **New User Flow Recording** | coconut-app: short path; video under ~15 min |

### 3. Enabling Tap to Pay on iPhone

| ID | Type | Requirement | How to demonstrate | Implement in |
|----|------|-------------|---------------------|---------------|
| 3.1 | Required | Highly visible, easily discoverable communication for Tap to Pay | New/Existing User Flow | coconut-app: prominent entry (e.g. home, nav) |
| 3.2 | Recommended | Full-screen modal (splash) for Tap to Pay (also Marketing 6.2) | New/Existing User Flow | coconut-app: hero/splash once |
| 3.3 | Required | Display TTP communication to all eligible users at least once (e.g. push) | New/Existing User Flow | coconut-app: in-app message or push |
| 3.4 | Required | Clearly show how to enable Tap to Pay at end of new merchant onboarding | **New User Flow Recording** | coconut-app: end of onboarding → enable TTP |
| 3.5 | Required | Clear action to accept Tap to Pay Terms and Conditions | New/Existing User Flow | coconut-app: explicit “Accept T&amp;C” |
| 3.6 | Required | Allow enabling Tap to Pay outside checkout (e.g. Settings) | New/Existing User Flow | coconut-app: Settings → Tap to Pay section |
| 3.7 | Required | In checkout: trigger to enable TTP, OR require TTP enabled before checkout | New/Existing User Flow | coconut-app: button opens T&amp;C if not enabled |
| 3.8 | Required | T&amp;C only accepted by administrator or authorized party | New/Existing User Flow | coconut-app: single-merchant = that user is “admin” |
| 3.8.1 | Required | If user not authorized: show message to contact admin to enable | New/Existing User Flow | coconut-app: if multi-role, show message |
| 3.8.2 | Conditional | Enterprise: accept T&amp;C outside app via Apple Business Connect (see PSP) | — | If Enterprise |
| 3.9 | Recommended | After T&amp;C + tutorial: dedicated “try it out” screen | New/Existing User Flow | coconut-app: optional CTA screen |
| 3.9.1 | Required | Show configuration progress via `PaymentCardReader.Event.updateProgress` (or PSP equivalent) | New/Existing User Flow | coconut-app: Stripe SDK progress → UI “Initializing…” |

### 4. Educating Merchants

| ID | Type | Requirement | How to demonstrate | Implement in |
|----|------|-------------|---------------------|---------------|
| 4.1 | Required | Use **ProximityReaderDiscovery** on iOS 18+ (fulfills 4.4, 4.6, 4.7, 4.8) | New/Existing User Flow | coconut-app: if iOS 18+, use Apple API; else 4.2+4.3 |
| 4.2 | Required | Display educational screens after user accepts T&amp;C | New/Existing User Flow | coconut-app: screens after T&amp;C (contactless, Apple Pay, etc.) |
| 4.3 | Required | Merchant education in Settings or Help for easy reference | New/Existing User Flow | coconut-app: Settings/Help → TTP education |
| 4.5 | Required | Education: how to accept contactless cards with Tap to Pay | New/Existing User Flow | Include in 4.2/4.3 |
| 4.6–4.8 | Conditional/Region | Apple Pay/digital wallets; PIN; fallback payment (see Regional Requirements) | As applicable | If not using 4.1, add per region |

### 5. Checking Out

| ID | Type | Requirement | How to demonstrate | Implement in |
|----|------|-------------|---------------------|---------------|
| 5.1 | Required | Clearly visible, prominent button to initiate Tap to Pay transaction | **Checkout Flow Recording** | coconut-app: prominent “Tap to Pay” button |
| 5.2 | Required | Button easily accessible without scrolling; when multiple options, TTP at top | **Checkout Flow Recording** | coconut-app: above the fold |
| 5.3 | Conditional | Button never greyed out; if not enabled, pressing opens T&amp;C | Checkout Flow | coconut-app: always tappable |
| 5.4 | Conditional | Multiple payment options: use localized copy (see Localization strings) | Checkout Flow | If multi-option, localize |
| 5.5 | Conditional | If using icon: SF Symbol `wave.3.right.circle` or `wave.3.right.circle.fill` | Checkout Flow | coconut-app: use these if showing icon |
| 5.6 | Required | TTP UI appears within 1 second 90% of the time (warm-up in advance) | **Checkout Flow Recording** | coconut-app: prepare reader at launch/foreground (1.5) |
| 5.7 | Required | When still configuring: show “initializing” screen | **Checkout Flow Recording** | coconut-app: progress/initializing UI (3.9.1) |
| 5.8 | Required | After successful card read: “processing” screen | **Checkout Flow Recording** | coconut-app: processing state before result |
| 5.9 | Required | Clearly show outcome: approved / declined / timed out | **Checkout Flow Recording** | coconut-app: success/declined/timeout screen |
| 5.10 | Required | Send confidential digital receipt (SMS / email / QR / Activity) whether approved or declined | **Checkout Flow Recording** | coconut-app: receipt option (email or Share sheet minimum) |
| 5.11 | Conditional | Regional requirements (PIN, fallback, etc.) | Checkout Flow | If applicable |

### 6. Marketing (Required at launch for public/unlisted)

| ID | Type | Requirement | How to demonstrate | Implement in |
|----|------|-------------|---------------------|---------------|
| 6.1 | Required | Launch email to all eligible users (use Marketing Guide “Launch” email) | — | When you launch to users |
| 6.2 | Required | In-app splash visible to all eligible at least once (“Hero” banner from Guide) | New/Existing User Flow | coconut-app: full-screen modal once (3.2) |
| 6.3 | Required | In-app push to all eligible (“Value Proposition” push copy from Guide) | — | coconut-app: push campaign at launch |

---

## Recording instructions (what to show in each video)

**Preferred:** Record with a **second iPhone** (point at device under test). Otherwise **screen recording** from the same device is acceptable.

### New User Flow — demonstrate:

- Onboarding path: account creation, KYC if applicable.
- How Tap to Pay is introduced after account approval.
- **T&amp;C acceptance** for Tap to Pay (if accepted outside app, show how completion is communicated).
- **Merchant education** after T&amp;C: what’s shown and where user can find it later (e.g. Settings).
- **Configuration progress** indicator while Tap to Pay is configuring.
- **Configuration completion** and first payment.
- If your app does *not* offer in-app new user onboarding, provide details on how new users onboard.
- *Re-accepting for recording:* If you need to “reaccept” T&amp;C for the recording, see Apple’s note about unlinking your Apple Account (link in checklist).

### Existing User Flow — demonstrate:

- **Before** T&amp;C: Tap to Pay **payment acceptance button exists and is visible** to existing users.
- Where an existing user **becomes aware** Tap to Pay is available (e.g. full-screen modal after login or app update).
- **Merchant education** after T&amp;C and **where to find it later** (e.g. Settings → Tap to Pay).
- If user completes/skips education before configuration is complete: **progress indicator** for configuration status.
- For applicable regions: **PIN transaction** and **Fallback Payment Method** (see Conditional Requirements).

### Checkout Flow — demonstrate:

- Adding items to cart **or** entering a currency amount.
- **Payment option(s)** and the **Tap to Pay on iPhone button**.
- **Initiate and complete** one Tap to Pay transaction.
- **PIN** (where applicable) and **Fallback** (where applicable) per Regional Requirements.

---

## Checklist Tab 2: Other Information

| Item | Filled value (use in Apple’s form) |
|------|------------------------------------|
| **Supported schemes** | Visa, Mastercard, American Express, Discover |
| **Domestic scheme** | — (leave blank unless applicable) |
| **Is Refund supported** | No |
| **Receipt methods** | Email (via service); using iOS Share (AirDrop and other apps) |
| **If PIN Fallback applicable: alternative payment methods** | Payment Link |
| **Other notes** | Tap to Pay for in-person payments via Stripe Terminal. Development distribution (test devices only). |

---

## Implementation gaps (coconut-app) — priority order

**Full step-by-step implementation:** See **`docs/TAP_TO_PAY_COCONUT_APP_IMPLEMENTATION.md`** for code snippets, file structure, and checklist mapping.

1. **1.4** — Handle `PaymentCardReaderError.osVersionNotSupported` (show “Update to latest iOS”).
2. **1.5** — Warm-up reader at app launch and when app comes to foreground (Stripe Terminal SDK “prepare”).
3. **1.6** — Use Stripe/PSP API for **Apple** T&amp;C acceptance status (not a local flag).
4. **3.4–3.9.1** — Onboarding end → enable TTP; clear Accept T&amp;C; Settings entry; configuration progress UI.
5. **4.1 or 4.2+4.3** — ProximityReaderDiscovery (iOS 18+) or educational screens + Settings/Help.
6. **5.1, 5.2, 5.6–5.10** — Prominent checkout button, initializing/processing/outcome screens, **digital receipt** (email or iOS Share minimum).
7. **6.2, 6.3** — In-app splash (Hero) once per user; push at launch (when you have eligible users).

Backend (coconut) already provides connection token, location, and payment intent; webhook records settlements. Receipt delivery (5.10) is implemented in the **mobile** app (e.g. “Share receipt” via iOS Share or email from app).

---

## Quick reference

| Item | Value |
|------|--------|
| Apple checklist | https://apple.box.com/v/ttpoirequirements (March 2026 v1.6) |
| Case ID | 18856933 |
| PSP | Stripe |
| Backend APIs | `app/api/stripe/terminal/*`, `app/api/stripe/webhook` (payment_intent.succeeded) |
| Terminal setup | `docs/STRIPE_TERMINAL_SETUP.md` |
| Mobile app | coconut-app repo — all TTP UI, SDK usage, and checklist items above |
