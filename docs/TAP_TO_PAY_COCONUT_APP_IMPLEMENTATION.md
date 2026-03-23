# Tap to Pay — coconut-app implementation guide

This doc tells you **exactly what to implement in the coconut-app repo** so the app passes the Apple Tap to Pay App Review checklist. The **coconut** (web) repo already provides the backend APIs; all work below is in **coconut-app** (Expo).

**Prerequisites:** Physical iPhone (XS or later), Expo dev build, `EXPO_PUBLIC_API_URL` pointing at deployed coconut web app.

---

## 1. Install dependencies

```bash
cd coconut-app
npx expo install @stripe/stripe-terminal-react-native
npx expo install expo-build-properties
```

Add to `app.json` / `app.config.js` (Expo):

- **iOS deployment target:** 16.7 or higher (Stripe recommends 16.7 for Tap to Pay). Example:

```js
// app.config.js
import "expo-build-properties";

export default {
  expo: {
    ios: {
      deploymentTarget: "16.7",
      infoPlist: {
        UIRequiredDeviceCapabilities: ["arm64", "location-services", "nfc"],
      },
    },
    plugins: [
      ["expo-build-properties", { ios: { deploymentTarget: "16.7" } }],
      // Your existing plugins, including the Tap to Pay entitlement
    ],
  },
};
```

- **Tap to Pay entitlement:** Ensure your config includes `com.apple.developer.proximity-reader.payment.acceptance` (often via a custom config plugin or `ios.entitlements`). See STRIPE_TERMINAL_SETUP.md in the coconut repo.

---

## 2. Connection token provider (required for Stripe Terminal)

Backend already has `POST /api/stripe/terminal/connection-token` (auth required). In coconut-app, wrap the app with `StripeTerminalProvider` and pass a `fetchConnectionToken` that calls your backend with the user’s auth (e.g. Clerk token).

**Example (adjust to your auth):**

```tsx
// app/_layout.tsx or providers
import { StripeTerminalProvider } from "@stripe/stripe-terminal-react-native";

const API_URL = process.env.EXPO_PUBLIC_API_URL;

async function fetchConnectionToken() {
  const token = await getClerkSessionToken(); // your auth
  const res = await fetch(`${API_URL}/api/stripe/terminal/connection-token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) throw new Error("Connection token failed");
  const data = await res.json();
  return data.secret;
}

export function RootLayout() {
  return (
    <StripeTerminalProvider
      logLevel="verbose"
      fetchConnectionToken={fetchConnectionToken}
    >
      {/* rest of app */}
    </StripeTerminalProvider>
  );
}
```

---

## 3. General requirements

### 3.1 Requirement 1.4 — iOS version error

For iOS &lt; 17.6, handle `PaymentCardReaderError.osVersionNotSupported` and show a message to update iOS.

When you call `discoverReaders` or `connectReader`, catch the error and check the code (Stripe may expose it as a string or enum). Show an alert or screen: “Tap to Pay requires the latest iOS. Please update your device.”

```tsx
// When discovering or connecting
const { error } = await discoverReaders({ discoveryMethod: "tapToPay" });
if (error?.code === "OsVersionNotSupported" || error?.message?.includes("OS version")) {
  setError("Tap to Pay requires the latest iOS. Please update your device.");
  return;
}
```

(Confirm exact error code from `@stripe/stripe-terminal-react-native` in your version.)

### 3.2 Requirement 1.5 — Warm-up at launch / foreground

At **app launch** and when the app **comes to the foreground**, trigger reader preparation so that when the user taps “Accept payment,” the Tap to Pay UI appears within ~1 second (requirement 5.6).

- Call `discoverReaders({ discoveryMethod: "tapToPay" })`.
- When you get a reader (or empty array on unsupported device), call `connectReader` with that reader and `locationId` (from backend `GET /api/stripe/terminal/location`).
- Do this in a root layout effect or a dedicated “Terminal” context that subscribes to `AppState` (foreground).

**Example flow:**

1. On mount + on foreground: `GET ${API_URL}/api/stripe/terminal/location` (with auth) → `locationId`.
2. `discoverReaders({ discoveryMethod: "tapToPay" })` → `onUpdateDiscoveredReaders` gives you a reader (or empty).
3. If reader exists and not already connected: `connectReader({ reader, locationId }, "tapToPay")`.
4. Store “reader connected” or “reader ready” in state so the checkout screen can show “Initializing…” until connected, then “Ready.”

This satisfies **1.5** (warm-up) and **5.6** (TTP UI within ~1 s).

### 3.3 Requirement 1.6 — T&C from Apple (not local)

Stripe Terminal shows **Apple’s** Tap to Pay Terms and Conditions when the user first connects. Do **not** store “user accepted T&C” in a local variable and use that to skip the flow. Let the SDK present Apple’s T&C; after the user accepts, the connection succeeds. You can show your own “Accept” button that triggers `connectReader`; the system T&C sheet is then shown by the SDK. Do not persist “accepted” locally for gate-keeping—the SDK and Apple handle status.

---

## 4. Onboarding & enabling Tap to Pay (sections 2 and 3)

### 4.1 New user flow (2.1–2.3, 3.4)

- After **account creation** and any required onboarding, show a clear step: **“Enable Tap to Pay”** (or “Set up Tap to Pay on iPhone”).
- Tapping it should:
  - Fetch `locationId` from `GET /api/stripe/terminal/location`.
  - Call `discoverReaders({ discoveryMethod: "tapToPay" })`, then `connectReader({ reader, locationId }, "tapToPay")`.
  - Apple’s T&C screen is shown by the system; after acceptance, connection completes.
- Then show **merchant education** (see below) and a **configuration progress** UI (see 3.9.1).
- Ensure the path from install → first payment is **under 15 minutes** (trim unnecessary steps for the video).

### 4.2 Clear “Accept T&C” action (3.5)

- Have a single prominent button: e.g. “Accept Tap to Pay Terms and Conditions” or “Enable Tap to Pay.”
- That button triggers the `connectReader` flow; the **first** time, Apple’s T&C is shown. No need to implement your own T&C text—Apple’s sheet is the source of truth.

### 4.3 Enable Tap to Pay outside checkout (3.6)

- Add a **Settings** (or **Help**) section: **“Tap to Pay on iPhone.”**
- From there the user can:
  - See status (e.g. “Ready” / “Not set up”).
  - Tap “Enable” or “Set up” → same flow as 4.1 (discover → connect with `locationId` → Apple T&C if needed).
- This satisfies “enable outside of checkout.”

### 4.4 Checkout: enable TTP or require it (3.7)

- On the **checkout** screen, either:
  - Show a prominent **“Tap to Pay on iPhone”** button that, if the reader isn’t connected yet, starts the connect (and T&C) flow; or
  - Require Tap to Pay to be enabled (e.g. in Settings) before checkout; if not enabled, show a message and a link/button to Settings.
- The button must **never be greyed out** (3.5/5.3): if not enabled, pressing it should open the T&C/setup flow.

### 4.5 Configuration progress (3.9.1)

- While the reader is **connecting** or **preparing**, show a progress indicator (e.g. “Initializing Tap to Pay…” or a spinner).
- Use Stripe’s callbacks (e.g. from `useStripeTerminal`) that report connection/reader updates; map them to a simple “Connecting…” / “Ready” / “Failed” UI.
- If the SDK exposes a progress callback (e.g. `onDidReportReaderSoftwareUpdateProgress` or similar), use it to show a percentage or indeterminate spinner.

---

## 5. Educating merchants (section 4)

### 5.1 Option A — ProximityReaderDiscovery (4.1, iOS 18+)

- If you support **iOS 18+**, use Apple’s **ProximityReaderDiscovery** API to educate merchants (per Apple’s docs). That can fulfill 4.4, 4.6, 4.7, 4.8.
- Check Apple’s “Tap to Pay on iPhone” and “Educating Merchants” docs for the exact API and UX.

### 5.2 Option B — In-app education (4.2, 4.3, 4.5)

- **After** the user accepts T&C, show **educational screens** that explain:
  - How to accept **contactless cards** (hold card near iPhone).
  - How to accept **Apple Pay and other digital wallets** (hold phone/watch near iPhone).
- Add a **“Tap to Pay”** subsection under **Settings** or **Help** that repeats this education (easy to find later).
- You can use simple screens with short bullets and illustrations; no need for video.

---

## 6. Checkout flow (section 5)

### 6.1 Prominent Tap to Pay button (5.1, 5.2, 5.5)

- On the **checkout** screen, show a **clearly visible** “Tap to Pay on iPhone” (or “Accept payment with Tap to Pay”) button.
- Place it **above the fold** (no scrolling required) and, if you have multiple payment options, put Tap to Pay **at the top**.
- If you use an icon, use SF Symbol **`wave.3.right.circle`** or **`wave.3.right.circle.fill`** (5.5).

### 6.2 Amount and payment screen

- User enters **amount** (or adds items → total). Then tap “Tap to Pay on iPhone.”
- Show a **payment screen** that displays:
  - **Amount** (large and clear).
  - **Merchant / business name** (e.g. “Coconut”).
  - **Tap instructions** (e.g. “Hold iPhone near customer’s card or phone”).
- This is the screen that stays visible while you call `collectPaymentMethod` and then `processPaymentIntent`.

### 6.3 Initializing (5.7)

- If the user taps “Tap to Pay” but the reader is **still connecting**, show an **“Initializing…”** screen (e.g. spinner + “Tap to Pay will be ready shortly”) until the reader is connected.

### 6.4 Collect and process payment

- **Create PaymentIntent on backend:**  
  `POST /api/stripe/terminal/create-payment-intent` with `{ amount: numberInDollars }` (and optional `groupId`, `payerMemberId`, `receiverMemberId` for settlements). Get `clientSecret`.
- **Collect:**  
  `collectPaymentMethod(clientSecret)` — reader will show “hold card/phone” prompt.
- **Process:**  
  After collect succeeds, call `processPaymentIntent(clientSecret)` (or the equivalent in the React Native SDK).
- **Processing screen (5.8):** After a successful card read, show a **“Processing…”** screen before showing the result.
- **Outcome (5.9):** Then show **approved** / **declined** / **timed out** clearly.

### 6.5 Digital receipt (5.10)

- **Regardless** of approved or declined, offer a way to send a **confidential** receipt: e.g. **Email** (via your backend or a mailto link) or **iOS Share** (Share sheet with receipt text or PDF).
- Simplest: a “Share receipt” button that uses React Native’s **Share** API with a short receipt text (amount, date, status). That satisfies “digital receipt” and “confidential” (user chooses where to send).

**Example:**

```tsx
import { Share } from "react-native";

function shareReceipt(amount: number, status: "approved" | "declined") {
  Share.share({
    message: `Payment ${status}: $${amount.toFixed(2)}. Coconut Tap to Pay.`,
    title: "Receipt",
  });
}
```

---

## 7. Marketing / splash (section 6)

- **6.2:** Show a **full-screen modal** (splash/banner) about Tap to Pay **once** per user (e.g. after login or on first app open after update). Use copy from Apple’s Tap to Pay Marketing Guide “Hero” in-app banner.
- **6.3:** When you launch to users, send an **in-app push** to eligible users with the “Value Proposition” push copy from the Marketing Guide.
- Store a “has seen Tap to Pay splash” flag (e.g. in AsyncStorage) so you only show the modal once.

---

## 8. File structure (suggested)

- `app/(tabs)/index.tsx` or `app/index.tsx` — Home; show prominent entry to “Tap to Pay” or “Accept payment.”
- `app/(tabs)/terminal.tsx` or `app/terminal.tsx` — Tap to Pay accept flow: amount → payment screen → collect → process → outcome + receipt.
- `app/(tabs)/settings.tsx` — Settings; add “Tap to Pay on iPhone” section (enable/disable, link to education).
- `app/onboarding.tsx` or similar — After sign-up; last step “Enable Tap to Pay” → connectReader flow + education.
- `components/terminal/` — Connection status, payment screen, initializing/processing/outcome UI, share receipt.
- `context/terminal.tsx` or `hooks/useTerminal.ts` — Hold `useStripeTerminal`, reader state, locationId, warm-up on foreground.

---

## 9. Backend (coconut) — already done

- `POST /api/stripe/terminal/connection-token` — connection token.
- `GET /api/stripe/terminal/location` — returns `locationId` (creates default if none).
- `POST /api/stripe/terminal/create-payment-intent` — body `{ amount, groupId?, payerMemberId?, receiverMemberId? }`, returns `{ clientSecret }`.
- Webhook: `payment_intent.succeeded` — records settlement when metadata present.

Ensure `EXPO_PUBLIC_API_URL` in coconut-app points at this backend and that requests send auth (e.g. Clerk session token).

---

## 10. Checklist → implementation map

| Requirement | Where in coconut-app |
|-------------|----------------------|
| 1.4 OS version error | Catch error in discover/connect; show “Update iOS” message. |
| 1.5 Warm-up at launch/foreground | discoverReaders + connectReader in root/context on mount and AppState active. |
| 1.6 T&C from Apple | Use Stripe’s connect flow; do not store “accepted” locally. |
| 2.1–2.3 New user flow | Onboarding ends with “Enable Tap to Pay” → connect + first payment &lt; 15 min. |
| 3.1–3.4 Discoverable TTP, end of onboarding | Nav entry + onboarding last step; splash once. |
| 3.5 Accept T&C | Single “Enable Tap to Pay” / “Accept T&C” button → connectReader. |
| 3.6 Enable in Settings | Settings → Tap to Pay section → same connect flow. |
| 3.7 Checkout trigger | Tap to Pay button on checkout; if not enabled, opens setup. |
| 3.9.1 Configuration progress | “Initializing…” UI while connecting. |
| 4.1 or 4.2+4.3 Education | ProximityReaderDiscovery (iOS 18+) or in-app screens + Settings/Help. |
| 5.1–5.2 Button | Prominent “Tap to Pay” button, above fold, SF Symbol optional. |
| 5.6–5.9 Speed, initializing, processing, outcome | Warm-up + “Initializing” + “Processing” + approved/declined/timeout screens. |
| 5.10 Receipt | “Share receipt” via Share API (and/or email). |
| 6.2–6.3 Splash + push | One-time modal; push at launch per Marketing Guide. |

---

## 11. Next steps

1. Open the **coconut-app** repo.
2. Install Stripe Terminal and expo-build-properties; add entitlement and deployment target.
3. Implement `StripeTerminalProvider` + `fetchConnectionToken` and warm-up (discover + connect on launch/foreground) with `locationId` from coconut backend.
4. Add onboarding step “Enable Tap to Pay,” Settings section, and checkout screen with Tap to Pay button, payment screen, collect/process, and receipt share.
5. Run on a **physical** iPhone, then record the three videos and fill the checklist as in `docs/TAP_TO_PAY_CHECKLIST_FILLED.md`.

If you open **coconut-app** in Cursor and share the layout/routing (e.g. which file is the root layout, which is settings, which is checkout), the same checklist can be implemented file-by-file there.
