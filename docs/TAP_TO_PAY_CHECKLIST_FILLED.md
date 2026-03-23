# Tap to Pay — Filled Checklist (copy into Apple’s form)

Use this to fill **both tabs** of the App Review Requirements Checklist. Replace `[FILL]` with your actual values before submitting.

**Case ID for reply:** 18856933

---

## Tab 1: INSTRUCTIONS

| Field | Filled value |
|-------|----------------|
| **Team ID** | `[FILL]` — Get from [developer.apple.com/account](https://developer.apple.com/account) → Membership details |
| **App Name** | Coconut |
| **PSP Name** | Stripe |
| **Date** | `[FILL]` — e.g. 2026-03-14 (submission date) |
| **Version** | 1.0.0 |
| **Existing or New app** | New app |
| **Distribution type (Public / Unlisted / Enterprise)** | Unlisted |
| **Number of Devices** | `[FILL]` — Number of registered test devices (e.g. 5) |

---

## Tab 2: Other Information

| Item | Filled value |
|------|----------------|
| **Supported schemes** | Visa, Mastercard, American Express, Discover |
| **Domestic scheme (please specify)** | — (leave blank unless you support a domestic scheme) |
| **Is Refund supported** | No |
| **Requires tapping card with Tap to Pay on iPhone** | N/A (refunds not supported) |
| **Referenced refund (requires a purchase transaction first)** | N/A |
| **Unreferenced refund (doesn't require a purchase transaction first)** | N/A |
| **Receipt methods** | Email (customer receives email from an email service, not from the merchant email address); using iOS Share (e.g. AirDrop and other apps) |
| **If PIN Fallback is applicable for your market, alternative payment methods** | Payment Link |
| **Other notes** | Tap to Pay used for in-person payments; backend via Stripe Terminal. Development distribution restriction (test devices only). |

---

## Requirements checklist — Status & Comments (for Apple’s table)

Copy **Status** and **Comments** into the official checklist where it has those columns.

### 1. General Requirements

| ID | Status | Comments (optional) |
|----|--------|----------------------|
| 1.1 | Done | Tap to Pay supported on iPhone XS and later via Stripe Terminal SDK. |
| 1.2 | N/A | Tap to Pay is not the sole primary payment method. |
| 1.3 | N/A | Same as 1.2. |
| 1.4 | Done | App handles PaymentCardReaderError.osVersionNotSupported and displays message to update iOS. |
| 1.5 | Done | Reader preparation/warm-up triggered at app launch and when app returns to foreground (per Stripe SDK). |
| 1.6 | Done | Merchant T&C acceptance status retrieved from Apple via Stripe Terminal SDK (not stored locally). |
| 1.7 | Done | Face ID / Touch ID used for app login where applicable. |
| 1.8 | N/A | Distribution is Unlisted (dev restriction); will comply when going public. |
| 1.9 | N/A | Same as 1.8. |

### 2. Onboarding Merchants

| ID | Status | Comments (optional) |
|----|--------|----------------------|
| 2.1 | Demonstrated in New User Flow | New users discover account creation and path to Tap to Pay in-app. |
| 2.2 | Demonstrated in New User Flow | Fully digital onboarding completed on iPhone. |
| 2.3 | Demonstrated in New User Flow | Onboarding to first Tap to Pay payment under 15 minutes; compliant with local merchant onboarding regulations. |

### 3. Enabling Tap to Pay on iPhone

| ID | Status | Comments (optional) |
|----|--------|----------------------|
| 3.1 | Demonstrated in New/Existing User Flow | Tap to Pay is highly visible and easily discoverable (home/navigation). |
| 3.2 | Demonstrated in New/Existing User Flow | Full-screen modal (splash) shown to eligible users at least once. |
| 3.3 | Demonstrated in New/Existing User Flow | TTP communication displayed to all eligible users at least once (in-app and/or push). |
| 3.4 | Demonstrated in New User Flow | End of new merchant onboarding clearly shows how to enable Tap to Pay. |
| 3.5 | Demonstrated in New/Existing User Flow | Clear action to accept Tap to Pay Terms and Conditions. |
| 3.6 | Demonstrated in New/Existing User Flow | Users can enable Tap to Pay in Settings (Tap to Pay section). |
| 3.7 | Demonstrated in New/Existing User Flow | Checkout offers trigger to enable TTP; if not enabled, button opens T&C acceptance. |
| 3.8 | Demonstrated in New/Existing User Flow | T&C accepted by authorized user (single-merchant model). |
| 3.8.1 | Demonstrated in New/Existing User Flow | If user not authorized, message instructs to contact admin (N/A for single-merchant). |
| 3.8.2 | N/A | Not Enterprise deployment. |
| 3.9 | Demonstrated in New/Existing User Flow | After T&C and tutorial, dedicated screen invites user to try Tap to Pay. |
| 3.9.1 | Demonstrated in New/Existing User Flow | Configuration progress shown via Stripe SDK (PaymentCardReader progress / equivalent); initializing screen during setup. |

### 4. Educating Merchants

| ID | Status | Comments (optional) |
|----|--------|----------------------|
| 4.1 | Done | ProximityReaderDiscovery used on iOS 18+ for merchant education (fulfills 4.4, 4.6, 4.7, 4.8). |
| 4.2 | Demonstrated in New/Existing User Flow | Educational screens displayed after user accepts T&C. |
| 4.3 | Demonstrated in New/Existing User Flow | Merchant education available in Settings / Help for easy reference. |
| 4.4–4.8 | Done / N/A | Covered by 4.1 or 4.2/4.3; regional (PIN/fallback) as applicable. |

### 5. Checking Out

| ID | Status | Comments (optional) |
|----|--------|----------------------|
| 5.1 | Demonstrated in Checkout Flow | Prominent button to initiate Tap to Pay transaction. |
| 5.2 | Demonstrated in Checkout Flow | Button easily accessible without scrolling; Tap to Pay at top when multiple options. |
| 5.3 | Demonstrated in Checkout Flow | Button never greyed out; if not enabled, opens T&C acceptance. |
| 5.4 | N/A | Single payment option (Tap to Pay). |
| 5.5 | Done | SF Symbol wave.3.right.circle or wave.3.right.circle.fill used where iconography is shown. |
| 5.6 | Demonstrated in Checkout Flow | Tap to Pay UI appears within 1 second (reader warmed up at launch/foreground). |
| 5.7 | Demonstrated in Checkout Flow | “Initializing” screen shown when still configuring. |
| 5.8 | Demonstrated in Checkout Flow | “Processing” screen shown after successful card read. |
| 5.9 | Demonstrated in Checkout Flow | Outcome clearly shown (approved / declined / timed out). |
| 5.10 | Demonstrated in Checkout Flow | Digital receipt available (email and/or iOS Share) for approved and declined transactions. |
| 5.11 | N/A | Regional requirements applied where applicable. |

### 6. Marketing

| ID | Status | Comments (optional) |
|----|--------|----------------------|
| 6.1 | Planned at launch | Launch email to eligible users using Tap to Pay Marketing Guide “Launch” email. |
| 6.2 | Demonstrated in New/Existing User Flow | In-app splash (Hero banner) visible to all eligible users at least once. |
| 6.3 | Planned at launch | In-app push to eligible users using “Value Proposition” push copy from Marketing Guide. |

---

## Before you submit

1. **Replace all `[FILL]`** in Tab 1: Team ID, Date, Number of Devices.
2. **Confirm** Tab 2 matches your app (e.g. if you add refunds or SMS receipts, update the table).
3. **Implement** every item marked “Done” or “Demonstrated” in coconut-app (see `TAP_TO_PAY_APP_REVIEW.md` implementation gaps).
4. **Record** the three videos (New User, Existing User, Checkout) showing the flows above.
5. **Copy** this content into Apple’s checklist file (both tabs), then attach it to your reply with Case-ID 18856933.
