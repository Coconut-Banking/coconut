# Apple Developer: Dev app + TestFlight on same device

To have **Coconut Dev** (local/development) and **Coconut** (TestFlight) on the same device, you need a second App ID for the dev build. Do the following in your Apple Developer account.

---

## 1. Create the dev App ID (Identifier)

1. Go to [developer.apple.com](https://developer.apple.com) → **Certificates, Identifiers & Profiles** → **Identifiers**.
2. Click the **+** button to register a new identifier.
3. Choose **App IDs** → Continue.
4. Select **App** → Continue.
5. Fill in:
   - **Description:** `Coconut Dev` (or any label you like).
   - **Bundle ID:** choose **Explicit** and enter:  
     `com.coconut.app.dev`  
     (Must match what you use in coconut-app’s app.config for the dev variant.)
6. **Capabilities:** enable the same ones as your main app (**com.coconut.app**), especially:
   - **Tap to Pay on iPhone** (Proximity Reader) if you use it in dev.
   - Any other capabilities your app uses (Sign in with Apple, Push Notifications, etc.).
7. Click **Continue** → **Register**.

You now have two identifiers:

| Identifier        | Bundle ID             | Use for        |
|------------------|------------------------|----------------|
| Coconut (existing) | `com.coconut.app`     | TestFlight / App Store |
| Coconut Dev (new)  | `com.coconut.app.dev` | Development builds    |

---

## 2. Devices (no change needed)

**Devices** are shared at the team level. The devices you already registered for **com.coconut.app** (Ad hoc / development) can be used for **com.coconut.app.dev** as well. You don’t need to add them again.

If you add a new device later, add it once under **Devices**; it will be available for both App IDs.

---

## 3. Provisioning profiles (let EAS handle them)

You currently have:

- **\*[expo] com.coconut.app AdHoc …** — Ad hoc (e.g. internal/TestFlight-style installs).
- **\*[expo] com.coconut.app AppStore …** — App Store distribution.
- **Coconut-Testing** — Development (shown Invalid; can be recreated if you need it).

For **com.coconut.app.dev**, EAS Build will create its own provisioning profiles when you build with the development profile (and the dev bundle ID in app.config). You don’t need to manually create profiles for the dev App ID in the Apple Developer portal unless you’re not using EAS.

If you use **Xcode / local builds** only for the dev app, then in Apple Developer:

- **Profiles** → **+** → choose **iOS App Development** → select **com.coconut.app.dev** → select your dev certificate and devices → generate and download the profile, then use it in Xcode.

---

## 4. Summary checklist

| Step | Action |
|------|--------|
| 1 | **Identifiers** → **+** → App ID → Explicit **com.coconut.app.dev**, description e.g. "Coconut Dev". |
| 2 | Enable the same capabilities as **com.coconut.app** (especially Tap to Pay if used). |
| 3 | **Register** the new identifier. |
| 4 | **Devices:** no change; existing devices work for both apps. |
| 5 | **Profiles:** use EAS to build dev; EAS will create profiles for **com.coconut.app.dev**. For local Xcode-only dev, create an iOS App Development profile for **com.coconut.app.dev** if needed. |

After this, building coconut-app with the dev variant (e.g. `APP_VARIANT=development` or EAS profile `development`) will use **com.coconut.app.dev** and can be installed alongside the TestFlight build of **com.coconut.app** on the same device.
