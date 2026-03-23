# Coconut — Product & UI spec for Figma

**Purpose:** Single reference for designers to model IA, screens, components, and visual system.  
**Codebases:** `coconut` (Next.js web) · `coconut-app` (Expo / React Native, primary product surface).

---

## 1. Product summary

| Surface | Role |
|--------|------|
| **iPhone app (`coconut-app`)** | Primary product: home, review, shared spaces, Tap to Pay, settings, receipt flows. |
| **Marketing site (`/` on web)** | Acquisition: brand story, App Store CTA, optional bank link copy. Dark hero, Syne + Instrument Sans (see §7). |
| **Authenticated web (`/app/*`)** | Full-feature web client for signed-in users: dashboard, transactions, subscriptions, shared, receipts, email receipts, settings. Sidebar + top bar. |
| **`/connect`** | Plaid Link (bank connection); can deep-link back to app (`coconut://connected`). |
| **`/login`** | Clerk sign-in / sign-up. |

**Positioning:** Personal finance with **natural-language understanding of transactions**, **merchant cleanup**, **shared expense groups & settlements**, **subscription visibility**, **receipt splitting**, optional **Tap to Pay on iPhone** for sellers. Bank data via **Plaid** (read-only positioning in UX).

---

## 2. User journeys (design-critical)

1. **New user (mobile-first)**  
   Install app → sign up (Clerk) → connect bank (often opens web `/connect` in browser) → return to app → see transactions / home.

2. **Search / ask**  
   User phrases a question (“coffee last month”, “Uber”) → app or web surfaces filtered transactions + totals (NL pipeline).

3. **Shared space**  
   Create or join group → add members / friends → assign transactions → see who owes whom → **settle** (mark settled; may involve payments / Tap to Pay in product vision).

4. **Tap to Pay (mobile only)**  
   Seller: Pay tab → Stripe Terminal / Apple Tap to Pay → charge in person; backend records payment.

5. **Receipt split**  
   Capture or upload receipt → line items → assign shares → finish split (web: `/app/receipt`; mobile: receipt tab).

6. **Web handoff**  
   “Open in app” from web header (mobile) → token handoff → deep link into app.

---

## 3. Information architecture

### 3.1 Marketing (web, unauthenticated)

| Route | Screen / purpose |
|-------|------------------|
| `/` | Landing: hero, search demo, settle card, search section, bank cleanup, Tap to Pay strip, App Store CTA, footer. |
| `/login` | Clerk auth. |
| `/connect` | Plaid connect flow + success → dashboard or `coconut://` return. |
| `/connect-from-app` | Entry when app sends user to web to connect bank. |
| `/auth/handoff` | Auth token handoff for app. |
| `/auth/return-to-app` | Return flow to native app. |

### 3.2 Authenticated web app (`/app/*`)

**Shell:** `AppLayout` — **sidebar** (md+) + **top bar** (search, notifications dot, mobile menu, “Open in app” on small screens).

| Route | Nav label | Purpose |
|-------|-----------|---------|
| `/app/dashboard` | Overview | High-level money overview, links into subscriptions / shared / settings. |
| `/app/review` | Review | Inbox-style review of items needing attention (implementation-specific). |
| `/app/transactions` | Transactions | Main ledger: filters, search query param `?q=`, NL / structured search, bulk actions. |
| `/app/subscriptions` | Subscriptions | Recurring charges, detection, management. |
| `/app/shared` | Shared | Groups, friends, balances, settlements. |
| `/app/receipt` | Split Receipt | Receipt capture → split workflow. |
| `/app/email-receipts` | Email Receipts | Gmail-linked receipt matching. |
| `/app/settings` | Settings | Accounts, Plaid, preferences, disconnect, etc. |
| `/app/test-gmail` | *(dev / internal)* | Gmail testing. |

**Global chrome behaviors**

- **Plaid alerts strip** below header when `needs_reauth` or `new_accounts_available` (amber / CTA to `/connect?update=1`).
- **Sidebar active state:** green tint bg `#EEF7F2`, green text `#3D8E62`.
- **Top search:** jumps to transactions with query (hidden on transactions page when that page owns search UI).

### 3.3 Mobile app (`coconut-app`, Expo Router)

**Tab bar (visible)**

| Tab | Route file | Title | Icon (Ionicons) |
|-----|------------|-------|-----------------|
| Home | `(tabs)/index.tsx` | Home | `wallet` |
| Review | `(tabs)/review.tsx` | Review | `albums-outline` |
| Shared | `(tabs)/shared/*` | Shared | `people` |
| Pay | `(tabs)/pay.tsx` | Pay | `hardware-chip-outline` |
| Settings | `(tabs)/settings.tsx` | Settings | `settings-outline` |

**Not in tab bar** (`href: null` or stack)

- `insights` — exists but hidden from tabs.
- `receipt` — receipt flow (stack / modal from elsewhere).
- `add-expense` — manual expense entry.

**Shared stack**

- `shared/index` — list of groups / people.
- `shared/group` — group detail.
- `shared/person` — person detail.

**Auth**

- `(auth)/` — sign-in, sign-up, index.
- `auth-handoff.tsx` — web→app handoff.
- `connected.tsx` — post–bank connect screen.

---

## 4. Screen inventory (what to design)

### 4.1 Web — authenticated

- **Overview (dashboard):** Cards/sections for spend summaries, subscriptions teaser, shared teaser, settings/manage links.
- **Transactions:** Dense table or list rows; merchant, date, amount, category; search modes (NL vs filters); empty / loading / error; mobile-friendly list.
- **Subscriptions:** List of recurring merchants, amounts, trends/alerts.
- **Shared:** Groups list, group detail, member rows, settlement history, “add friend” flows (see API: groups, members, summary).
- **Split receipt:** Steps: upload / camera → parse → assign line items → confirm.
- **Email receipts:** Connection state, list, match to transactions.
- **Settings:** Bank connections, disconnect, account list, app-related links.
- **Connect (Plaid):** Multi-step: intro, Link modal, success, CTA to app or dashboard.
- **Login:** Clerk-themed or default; consider alignment with green brand.

### 4.2 Web — marketing (`/`)

- Dark `#0a0a0a` canvas, subtle grid, green glow.
- **Hero:** headline “Your money, cleaned up.”, typewriter search mock, **App Store** primary CTA, secondary “Connect bank on web”.
- **Settle column:** White floating card (trip, avatars, owes / you owe, green CTA).
- **Search section:** Example chips + answer card mock.
- **Bank section:** Light `#f4f4f5` band, before/after merchant cleanup.
- **Tap to Pay:** Phone frame mock + seller copy.
- **Footer CTA:** App Store again.

**Brand asset on marketing:** `/brand/coconut-mark.jpg` (organic B&W coconut mark in nav/footer).

### 4.3 Mobile — primary product

- **Home:** Balances, recent activity, quick actions, connect bank CTA if needed.
- **Review:** Queue of transactions/items to review.
- **Shared:** Groups, balances, settle UX, person/group detail.
- **Pay:** Tap to Pay / Terminal: amount, charge, success/failure, permissions states.
- **Settings:** Profile, bank, Tap to Pay enablement, legal, sign out.
- **Receipt / add-expense:** Flows as secondary entry points.

Design for **iOS safe areas**, **dark/light** if theme toggle exists (`theme-context`), **large tap targets**, **Stripe / Apple Tap to Pay** compliance screens (education, T&C).

---

## 5. Design tokens

### 5.1 Brand (canonical — use across web + mobile)

| Token | Hex | Usage |
|-------|-----|--------|
| Primary | `#3D8E62` | Buttons, links, active nav, positive money cues. |
| Primary hover | `#2D7A52` | Button hover. |
| Primary light bg | `#EEF7F2` | Selected row, soft highlights, “Open in app” chip. |
| Primary border | `#C3E0D3` | Outlines, badges. |
| Mint accent | `#6DD9A4` | Landing accents, icons on dark. |
| Page bg (web app) | `#F7FAF8` | Main app background behind content. |
| Surface | `#FFFFFF` | Cards, sidebar, header. |
| Border UI | `#E8EAEC` / `gray-100` | Dividers, inputs. |

### 5.2 Semantic (mobile `lib/theme.ts` — align Figma)

- Text: `#1F2937` primary, `#6B7280` tertiary, `#9CA3AF` muted.
- Error: `#DC2626`, amber warnings, blue/purple accents for avatars and charts (`ACCENT_PALETTE`).

### 5.3 Typography

| Context | Font | Notes |
|---------|------|--------|
| **Web app (body)** | Instrument Sans | `next/font` on `<html>`; `--font-instrument`. |
| **Web marketing headlines** | Syne | `font-display`; `--font-syne`. |
| **Mobile** | Inter (Expo Google fonts) | `Inter_400Regular` … `Inter_900Black` in `lib/theme.ts`. |

**Figma:** Set text styles for **Display / H1–H3 / Body / Caption / Label / Amount / Amount Lg** matching mobile `type` object where possible.

### 5.4 Radius & elevation

- Web cards: `rounded-2xl`, `border border-gray-100`, generous padding `p-6`.
- Buttons: `rounded-xl`, `px-5 py-2.5` primary.
- Inputs: `rounded-xl`, `focus:ring-2 ring-[#3D8E62]/20`.
- Mobile: `radii` sm 8 → 2xl 20 (`lib/theme.ts`).

### 5.5 Spacing

- Mobile: 8pt grid — `space.xs` 4 through `5xl` 48.
- Web: Tailwind `gap-4`, `gap-6`, `p-4`, `p-6` common in dashboard.

### 5.6 Motion

- **`motion/react`** on web for enter transitions; keep subtle (opacity + short translate).
- Respect `prefers-reduced-motion` in high-polish designs.

---

## 6. Components to spec in Figma

**Navigation**

- Web: Sidebar item (default / active), mobile drawer, top bar, search field, user menu, Plaid alert banner.
- Mobile: Tab bar (5 tabs), stack headers.

**Content**

- Transaction row (merchant logo optional, amount sign, pending state).
- Stat card, list section header, empty state, skeleton loader.
- Subscription row, price change badge, duplicate badge.
- Group card, member avatar stack, balance pill, settle button.
- Receipt line item row, split slider or share controls.

**Actions**

- Primary / secondary / ghost / destructive buttons.
- App Store badge (white pill, Apple glyph, “Download on the App Store”).

**System**

- Toast / inline error, modal, bottom sheet (mobile), Plaid modal (external — placeholder frame only).

---

## 7. Content & copy patterns

- **Search placeholder (web header):** “Search your money. Try: dinner with Alex in January”
- **Trust (landing):** 256-bit encryption, read-only bank access, no credential storage.
- **Connect success:** Bank connected; importing transactions; return to app vs view dashboard.
- **Tone:** Calm, direct, not “banky”; emphasize **understanding** over raw dashboards.

---

## 8. Integrations (UX implications only)

| Integration | User-visible |
|-------------|----------------|
| **Clerk** | Sign in/up, user avatar, email, sign out. |
| **Plaid** | Link / re-auth / new accounts available; institution picker inside Plaid modal. |
| **Stripe Terminal** | Tap to Pay on iPhone; loading, success, error, permissions. |
| **Gmail** | Email receipts: OAuth, scan status, matched receipts. |

---

## 9. Suggested Figma file structure

1. **00 Tokens** — Color, type, radius, elevation, spacing.
2. **01 Foundations** — Grid, breakpoints (web sidebar ≥ md, mobile 390×844 baseline).
3. **02 Components** — Buttons, inputs, rows, cards, nav, tab bar.
4. **03 Marketing** — Landing frames (desktop + mobile).
5. **04 Web app** — Dashboard, Transactions, Subscriptions, Shared, Receipt, Email receipts, Settings, Connect, Login.
6. **05 Mobile app** — Home, Review, Shared (list/group/person), Pay (Tap to Pay), Settings, Receipt, Auth.
7. **06 Flows** — Connect bank end-to-end, handoff to app, settle flow, first-time Tap to Pay.

---

## 10. Assets

| Asset | Location |
|-------|----------|
| Coconut mark (organic B&W) | Repo: `coconut.jpg`; served on web: `public/brand/coconut-mark.jpg` |
| Favicon | `app/icon.svg` (web) |

---

## 11. Reference docs in repo

- `PROJECT_SPEC.md` — stack, paths, **legacy** note: Inter in spec; web now uses Instrument Sans + Syne on marketing.
- `AGENTS.md` / `CLAUDE.md` — UI guardrails (primary green, card patterns).
- `docs/STRIPE_TERMINAL_SETUP.md` — Tap to Pay backend.
- `docs/MOBILE_BUILDS_TESTFLIGHT_AND_DEV.md` — mobile builds.
- `coconut-app/lib/theme.ts` — full mobile tokens and text styles.

---

## 12. Open design questions (for PM + design)

- Dark mode parity between web app and mobile (marketing is dark; app shell is light).
- Unified **component kit** name (e.g. “Coconut UI”) for Figma ↔ code alignment.
- Official **App Store** URL and screenshot set for marketing compliance.
- Whether **web app** should converge typography with marketing (Syne for web H1s only, etc.).

---

*Last updated from codebase snapshot (coconut + coconut-app). For implementation details, follow existing patterns in `components/AppLayout.tsx` and `coconut-app/lib/theme.ts`.*
