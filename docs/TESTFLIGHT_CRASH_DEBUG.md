# TestFlight crash on open — debugging

The **TestFlight app is the Expo app** from the **coconut-app** repo, not this (coconut) web repo. Use this guide when the app crashes immediately on launch (e.g. "Coconut (9b6df1) crashed").

## 1. Get a crash log (required to fix)

Without a stack trace, we can only guess. Get one of these:

- **Xcode**  
  - Window → Organizer → Crashes → select the build (e.g. 9b6df1) and device.  
  - Or: Window → Devices and Simulators → select device → Open Console, then reproduce the crash and copy the first 50–80 lines (exception + stack).

- **App Store Connect**  
  - TestFlight → build (e.g. 9b6df1) → Crashes.  
  - Download the crash report and note the **exception type** and **first few frames** of the stack (e.g. main thread crash in `RCTBridge`, `EXJavaScriptContext`, or a specific JS file).

- **EAS (Expo Application Services)**  
  - If you use EAS Build: build page → view logs.  
  - Check for build-time errors (missing env, native module failure).

Share the **exception message** and **first 10–15 lines of the stack** (or the full .crash / .ips file) so we can target the fix in **coconut-app**.

## 2. Common causes of “crashes on open”

Check these in the **coconut-app** repo:

| Cause | What to check |
|-------|----------------|
| **Missing / wrong env in release** | `EXPO_PUBLIC_*`, Clerk publishable key, Supabase URL/key, API base URL. Ensure production env is set in EAS secrets or in the build profile used for TestFlight. |
| **Native module / config** | `app.json` / `app.config.*`: bundle ID, scheme, plugins. Any native dependency that might not be linked or that fails in release. |
| **JS crash before first paint** | Top-level code (e.g. in root `_layout` or index) that throws: `undefined` access, missing env, or calling an API without a guard. Add a top-level error boundary or try/catch and log to see the error. |
| **Hermes / engine** | If you recently switched to/from Hermes or changed React Native version, ensure the TestFlight build matches (clean build, correct `jsEngine` in config). |

## 3. Quick mitigations in coconut-app

- **Env**: In the build used for TestFlight (e.g. EAS production profile), confirm all `EXPO_PUBLIC_*` and any server-side env (if used at build time) are set. Compare with a working build.
- **Error boundary**: Wrap the root component so a JS error shows an error screen (or sends to a service) instead of crashing the process.
- **Startup guard**: If the app reads env or config on load, wrap in try/catch and show a “Something went wrong” screen with the message (or log it) so you can see the real error on device.

## 4. Where to fix

- **Code / config / env**: In the **coconut-app** repo (Expo app).
- **Backend / API**: This repo (coconut) if the crash is due to wrong API URL or auth (e.g. Clerk key) — but the fix for the binary itself is still in coconut-app.

Once you have the crash log (exception + stack), use it to narrow down which of the above applies and then fix in coconut-app (or adjust env/secrets for the TestFlight build).

---

## 5. Observed crash pattern (build 9b6df1, TestFlight)

**Crash signatures seen:**
- `Coconut: NO_CRASH_STACK` (Thread 7)
- `hermesvm: hermes::vm::HadesG...`
- `React: +[RCTJSThread Manager runRunLoop...]`
- `React: invocation function for block in f...`
- `UIKitCore: -[UIEvent Fetcher threadMain]...`

**Stack (Thread 7):**
- `libc++abi.dylib _cxa_rethrow` / `libobjc.A.dylib objc_exception_rethrow` → exception caught and rethrown
- `React invocation function for block in face...` → React Native bridge executing a JS-triggered native call
- `React std::1::_function::_func<facebo...` → RN C++ callback
- `libdispatch.dylib _dispatch_call_block_and_release` / `_dispatch_client_callout` → work running on a queue

**Interpretation:** A JavaScript exception (or a native module throwing when called from JS) is being rethrown across the React Native bridge. The crash happens in the bridge layer, so the *root cause* is on the JS side or in a native module invoked at startup. Hermes is in the stack, so it’s likely an unhandled JS error or a native call that throws.

**What to do in coconut-app:**
1. **Root cause**: Look at code that runs before first paint: root `_layout.tsx`, any top-level `useEffect`, and native modules used on load (Clerk, Supabase, env/config). A missing env var or `undefined` access there can surface as this rethrow.
2. **See the real error**: Add a root error boundary (and optionally `ErrorUtils.setGlobalHandler`) to log or display the JS error message so the next crash gives a clear message instead of just NO_CRASH_STACK.
3. **Env**: Verify all `EXPO_PUBLIC_*` (and any keys the app reads immediately) are set in the EAS profile used for the TestFlight build.
4. **Symbols**: If you have Hermes bytecode or source maps, symbolicate the crash to get the exact JS file/line; that will point to the offending call.
