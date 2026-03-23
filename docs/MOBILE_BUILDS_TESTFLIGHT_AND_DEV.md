# coconut-app: Local dev build + TestFlight

How to run a **local development build** (for day-to-day dev and Tap to Pay testing) and ship a **TestFlight build** (for testers and Apple review). All commands below are run from the **coconut-app** repo.

**Opening both repos in one workspace:** In the coconut repo root there is **`coconut.code-workspace`**. Open it in Cursor/VS Code (File → Open Workspace from File) to have both **coconut** and **coconut-app** in the same window so you can edit and push both. The workspace expects coconut-app at `../coconut-app` (sibling of coconut); if your coconut-app is elsewhere, edit the `path` for the second folder in the workspace file.

---

## Same device: dev app + TestFlight app side by side

You can have **both on the same iPhone**: one app that updates from local changes (Metro), and one that only updates when you install a new build from TestFlight. iOS allows only **one app per bundle ID**, so you use two bundle IDs and two app names.

### What to do (in coconut-app)

**1. Register the dev bundle ID in Apple Developer**  
- See **`docs/APPLE_DEVELOPER_DEV_AND_TESTFLIGHT.md`** for step-by-step Apple Developer changes.  
- In short: Identifiers → + → App ID → Explicit `com.coconut.app.dev`, enable same capabilities as `com.coconut.app` (e.g. Tap to Pay), then Register.

**2. Make app name and bundle ID depend on build type**  
In coconut-app’s **app.config.js** (or **app.config.ts**), define a “dev” variant and use it for `name` and `ios.bundleIdentifier`:

```js
const IS_DEV =
  process.env.APP_VARIANT === "development" ||
  process.env.EAS_BUILD_PROFILE === "development";

export default {
  expo: {
    name: IS_DEV ? "Coconut Dev" : "Coconut",
    // ... your existing slug, version, etc.
    ios: {
      bundleIdentifier: IS_DEV ? "com.coconut.app.dev" : "com.coconut.app",
      // ... rest of ios config (entitlements, etc.)
    },
  },
};
```

(Use your real bundle IDs if they differ from `com.coconut.app`.)

**3. Use the dev variant for local and EAS development builds**  
- **Local:** When you run the app locally, set `APP_VARIANT=development` so the dev bundle ID and name are used. E.g. in coconut-app’s `.env`:  
  `APP_VARIANT=development`  
  Or run:  
  `APP_VARIANT=development npx expo run:ios --device`  
- **EAS development profile:** `EAS_BUILD_PROFILE` is set to `development` by EAS, so an EAS build with profile `development` will automatically get the dev bundle ID and “Coconut Dev”.

**4. Keep preview/production on the main bundle ID**  
- Do **not** set `APP_VARIANT=development` when building for TestFlight.  
- Your **preview** and **production** EAS profiles should not set `APP_VARIANT`, so they use the non-dev branch in app.config and keep bundle ID `com.coconut.app` and name “Coconut”.

**5. Install both on the same device**  
- **Dev app:** Run `APP_VARIANT=development npx expo run:ios --device` (or install the IPA from an EAS `development` build). You get **Coconut Dev**; it loads JS from Metro and updates on reload.  
- **TestFlight app:** Install **Coconut** from TestFlight as usual. It only updates when you install a new TestFlight build.

Result: two icons on one device — **Coconut Dev** (local updates) and **Coconut** (TestFlight updates).

---

## 1. Local development build

Use this when you’re coding and testing on a device or simulator. The app loads JavaScript from your machine (Metro) so you get fast refresh and can point at local or staging APIs.

### Option A: Run on device/simulator from Xcode (recommended for Tap to Pay)

Tap to Pay requires a **physical device**; the simulator doesn’t support NFC.

```bash
cd coconut-app
npx expo run:ios
```

- Picks a connected iPhone or the simulator.
- Builds the native app (or uses an existing build) and starts Metro. JS loads from Metro; you can change `EXPO_PUBLIC_*` and reload.
- For a **specific device**: `npx expo run:ios --device` (lists physical devices) or `npx expo run:ios --device "Device Name"`.

**Env for local dev:** Use a `.env` or `.env.local` in coconut-app with e.g. `EXPO_PUBLIC_API_URL=http://YOUR_MACHINE_IP:3000` (coconut web running locally) or your staging URL. Reload the app after changing env.

### Option B: EAS development build (install once, then use Expo Go or dev client)

If you prefer a **development client** that you install once and then use like Expo Go:

```bash
cd coconut-app
eas build --profile development --platform ios
```

- After the build finishes, install the IPA on your device (EAS gives a link or you download from the EAS dashboard).
- Then run `npx expo start --dev-client` and scan the QR code / open the dev client. The app will load your bundle from Metro.

Use this when you want the same native binary for a while and only refresh JS. For Tap to Pay, use a **physical device** with the development build.

---

## 2. TestFlight build

TestFlight builds are **standalone** IPAs (no Metro). They’re built by EAS with a **preview** or **production** profile and then submitted to App Store Connect so testers (and Apple) can install via TestFlight.

### One-time setup (coconut-app)

1. **EAS and Apple**
   - Log in: `npx eas login`
   - Link the project: `npx eas build:configure` (creates/updates `eas.json`).
   - Ensure the Apple Developer account and app (bundle ID) are set up; EAS can create credentials or use existing ones: `npx eas credentials` (choose iOS → production or preview).

2. **`eas.json` profiles**

   You want at least:
   - **development** — for local/dev client (optional; see Option B above).
   - **preview** — internal/internal testing, good for TestFlight before production.
   - **production** — for App Store / external TestFlight when you’re ready.

   Example (customize to your bundle ID and scheme):

```json
{
  "cli": { "version": ">= 5.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "ios": { "simulator": false }
    },
    "preview": {
      "distribution": "internal",
      "ios": { "simulator": false },
      "env": { "EXPO_PUBLIC_API_URL": "https://coconut-app.dev" }
    },
    "production": {
      "distribution": "store",
      "ios": { "simulator": false },
      "env": { "EXPO_PUBLIC_API_URL": "https://coconut-app.dev" }
    }
  },
  "submit": {
    "production": {
      "ios": {
        "appleId": "your-apple-id@email.com",
        "ascAppId": "YOUR_APP_STORE_CONNECT_APP_ID",
        "appleTeamId": "YOUR_TEAM_ID"
      }
    },
    "preview": {
      "ios": {
        "appleId": "your-apple-id@email.com",
        "ascAppId": "YOUR_APP_STORE_CONNECT_APP_ID",
        "appleTeamId": "YOUR_TEAM_ID"
      }
    }
  }
}
```

- Use **preview** for TestFlight internal testers and for Apple Tap to Pay review (videos, etc.).
- Use **production** when you’re ready for external TestFlight / App Store.
- Set `EXPO_PUBLIC_API_URL` (and any other env) in the profile so the TestFlight build talks to the right backend. No Metro in these builds.

### Build and upload to TestFlight

**Build:**

```bash
cd coconut-app
eas build --profile preview --platform ios
```

- For production: `eas build --profile production --platform ios`.
- Wait for the build on the EAS dashboard; download the IPA if you need it.

**Submit to TestFlight:**

```bash
eas submit --platform ios --profile preview
```

- EAS will use the **latest** build for that profile (or prompt you to pick one) and upload it to App Store Connect.
- After processing (often 5–15 minutes), the build appears in **App Store Connect → TestFlight**. Add internal/external testers and groups as needed.

**One command (build + submit):**

```bash
npx testflight
```

- Interactive: picks platform, builds, then submits the build to TestFlight. Handy after you’ve configured credentials and `eas.json` once.

---

## 3. Quick reference

| Goal | Command / step |
|------|-----------------|
| **Both on same device** | Use two bundle IDs: dev = `com.coconut.app.dev` ("Coconut Dev"), TestFlight = `com.coconut.app` ("Coconut"). See "Same device" section above. |
| **Local dev on device (Tap to Pay)** | `APP_VARIANT=development npx expo run:ios --device` (or set env in .env); ensure `EXPO_PUBLIC_API_URL` points at your backend. |
| **Local dev client (install once)** | `eas build --profile development --platform ios` → install IPA → `npx expo start --dev-client`. |
| **New TestFlight build** | `eas build --profile preview --platform ios` then `eas submit --platform ios --profile preview` (or use `npx testflight`). |
| **Env for TestFlight** | Set `EXPO_PUBLIC_API_URL` (and other env) in the `preview` / `production` profile in `eas.json`; no `.env` in the installed app. |

---

## 4. Tap to Pay–specific notes

- **Tap to Pay only works on a physical iPhone** (XS or later). Simulator builds won’t show Tap to Pay.
- Use a **development build** (`expo run:ios` or EAS development profile) for daily Tap to Pay testing.
- For **Apple review**, ship the same flow in a **TestFlight build** (preview or production profile) and record the three videos from that build.
- Ensure the TestFlight profile’s `EXPO_PUBLIC_API_URL` points at the **deployed** coconut backend that has the Terminal routes and webhook configured.
