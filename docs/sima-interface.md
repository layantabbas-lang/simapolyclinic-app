# SIMA interface layer — extraction report

Source: `C:\Maleks System\Sima` (read-only, not modified). Extracted 2026-07-24
for `C:\Maleks System\polyclinic app`.

SIMA's `package.json` name is `react-example`; the app identifies itself as
**SIMA — Smart Integrated Medical Archive** (`index.html`), and its
`render.yaml` service is still named `auracare` — a leftover from an earlier
product name ("AuraCare") that shows up in a few places (see §10). Under the
hood it began life as a single-purpose "Medical Document Analyzer" AI tool
(`metadata.json`) and grew a full clinic system around it — that origin still
shapes the codebase: there's no router, no shared UI kit, and one 7,900-line
file carries most of the clinical workflow.

---

## 1. Stack

| Concern | SIMA's choice |
|---|---|
| Framework | React **19.0.1** (`react`, `react-dom` ^19.0.1) — no Next.js, no Remix |
| Language | TypeScript **~5.8.2**, `tsc --noEmit` used as the only "lint" step (no ESLint/Prettier config anywhere in the repo) |
| Styling | Tailwind CSS **v4.1.14** via `@tailwindcss/vite`, CSS-first config (`@theme` block, no `tailwind.config.js`) — see §2 for how inconsistently it's actually used |
| State management | Plain `useState`/`useEffect`/`useContext`. No Redux, Zustand, Jotai, or Recoil. One custom context (`VisitNotesProvider`/`useVisitNotes` in `src/components/VisitNotesManager.tsx`) |
| Routing | **None.** No `react-router` or any router in `package.json`. Navigation is a single `viewMode` string in `App.tsx` state (`"calendar" \| "patients" \| "admin_console" \| "pharmacy" \| "dashboard" \| "care_queue" \| "bed_board" \| "extractor"`), switched by button `onClick`, with no URL sync — refreshing the page always returns to the default view for that role |
| Forms | **No form library.** No `react-hook-form`, `formik`, `zod`, or `yup` in `package.json`. Every form is controlled inputs (`useState` per field) with hand-written validation in the submit handler (regex date checks, `.trim()` checks, custom duplicate-record lookups) |
| Data fetching | **No TanStack Query / SWR.** Direct `supabase.from(table).select()/.insert()/.update()` calls inline inside components, each wrapped by hand in `try/catch/finally` with local `isLoading`/error `useState` |
| Build tool | Vite **6.2.3** for the client; `esbuild` bundles the custom Express server (`server.ts`) to `dist/server.cjs` for production; `tsx` runs it directly in dev |
| UI component library | **None.** No MUI, Chakra, Radix, shadcn/ui, Ant Design, etc. Every screen builds its own buttons/modals/inputs from scratch |
| Date library | **None.** Hand-rolled: `isoToDDMM`, `ddmmToIso`, `formatDateDDMMYYYY` in `src/components/PatientsDirectory.tsx:61-73,206-232`, plus native `Date.prototype.toLocaleDateString("en-GB")` calls scattered through components |
| Table library | **None.** Every `<table>` (in `AdminConsole.tsx`, `PharmacyManager.tsx`, `DashboardManager.tsx`, `ReportDashboard.tsx`, `TestManager.tsx`, `PatientsDirectory.tsx`) is hand-written markup — no TanStack Table, ag-Grid, etc. |
| Icons | `lucide-react` **0.546.0**, used consistently everywhere |
| Other deps worth flagging | `motion` **12.23.24** (Framer Motion's successor) is in `package.json` but **not imported anywhere in `src/`** — dead dependency. `@anthropic-ai/sdk` **0.32.1** is used server-side only (`server.ts`), for the original document-extraction feature | 

### Backend communication — two separate channels

1. **Direct from the browser**, via `@supabase/supabase-js` **2.43.4**
   (`src/supabaseClient.ts`) — reads/writes to Postgres tables and Supabase
   Auth, gated by Row Level Security (67 `create policy` statements in
   `schema_consolidated.sql`, RLS enabled on every table via a loop at line
   789). This is the same trust model the polyclinic app's own
   `docs/database.md` describes.
2. **A bespoke Express server** (`server.ts`, 419 lines) for anything that
   needs a secret the browser must never see:
   - `POST /api/analyze` — calls Claude via `@anthropic-ai/sdk` to extract
     structured data from an uploaded clinical document
   - `POST /api/admin/create-staff` — uses the Supabase **service-role**
     key to create a new Auth user (the Admin Console's "add staff" form
     posts here rather than calling `supabase.auth.admin` from the browser)
   - `POST /api/send-whatsapp` — Twilio, for appointment confirmations
   - `GET /api/health` — trivial liveness check, polled by `App.tsx` on load
   - In dev, Vite runs as Express middleware; in prod, Express serves the
     built static files and falls through to `index.html` for client-side
     routes (`app.get("*", ...)` at `server.ts:409`)

   This mirrors the polyclinic app's own stated rule almost exactly — "the
   service-role key must never reach the browser" — so that constraint
   carries over cleanly.

`supabaseClient.ts` also has a soft-fail mock mode: if
`VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` aren't set, `supabase.from()`
returns a fake chain that resolves with empty data instead of throwing,
so the UI stays usable (with warnings in the console) even unconfigured.

---

## 2. Design tokens

**Source of truth:** `src/index.css` (`C:\Maleks System\Sima\src\index.css`),
using Tailwind v4's CSS-first `@theme` block. There is no
`tailwind.config.js` — everything lives in this one file.

The whole app is themed as **"Soft Slate Blue"**: the file's own comment
calls it an "eye-comfort palette: no pure white surfaces, no pure black
text." Every standard Tailwind color name (`slate`, `gray`, `blue`,
`indigo`, `teal`, `violet`, `purple`, `emerald`, `green`, `amber`, `yellow`,
`red`, `rose`) is **redefined** to funnel into one of five actual palettes,
so `bg-blue-500` and `bg-indigo-500` and `bg-teal-500` all render the same
color. That's a deliberate, centralized design decision, not drift.

### Color palette (hex)

**Neutrals** (`--color-slate-*`, mirrored 1:1 onto `--color-gray-*`):
| Token | Hex |
|---|---|
| white (redefined) | `#fcfdfe` |
| slate-50 | `#f4f6f9` |
| slate-100 | `#edf1f5` |
| slate-200 | `#dee4eb` |
| slate-300 | `#c9d2dc` |
| slate-400 | `#8a96a5` |
| slate-500 | `#71808f` |
| slate-600 | `#5d6b7c` |
| slate-700 | `#3c4b5c` |
| slate-800 | `#2b3949` |
| slate-900 | `#1f2e3e` |
| slate-950 | `#16202b` |

**Primary** (`--color-blue-*`, mirrored onto `indigo-*` and `teal-*`; `violet-500/600` and `purple-500/600` also point at 500/600):
| Token | Hex |
|---|---|
| blue-50 | `#edf3f8` |
| blue-100 | `#dee9f3` |
| blue-200 | `#c2d5e7` |
| blue-300 | `#9dbbd6` |
| blue-400 | `#6e9cc9` |
| blue-500 | `#4a7ba6` |
| blue-600 | `#33608d` |
| blue-700 | `#2a5178` |
| blue-800 | `#224264` |
| blue-900 | `#1b344e` |
| blue-950 | `#12233a` |

**Success** (`--color-emerald-*`, mirrored onto `green-*`):
`50 #e7f2ec · 100 #d5e8de · 200 #b5d6c5 · 300 #8fc0a8 · 400 #5fa583 · 500 #438a6a · 600 #35795c · 700 #2c6349 · 800 #24503c · 900 #1c3f2f`

**Warning** (`--color-amber-*`, mirrored onto `yellow-*`):
`50 #faf3e3 · 100 #f5e7c8 · 200 #ead096 · 300 #d9b86a · 400 #cfa34d · 500 #a8842d · 600 #8f6d1e · 700 #75581a · 800 #5c4514 · 900 #47350f`

**Danger** (`--color-red-*`, mirrored onto `rose-500/600`):
`50 #f9ecec · 100 #f3dbdb · 200 #e7bcbc · 300 #db9d9b · 400 #db7a78 · 500 #c05654 · 600 #b3403e · 700 #96322f · 800 #7a2826 · 900 #601f1e`

### Live "specialty accent" — a second, dynamic color layer

On top of the static palette, three CSS custom properties are set on
`document.documentElement` at runtime and swapped whenever an admin picks
a different department in the top nav (`App.tsx:65-74`, driven by the
`SPECIALTIES` array in `src/components/SignIn.tsx:21-112`):

```css
--theme-accent: #33608d;       /* default, overwritten per specialty */
--theme-accent-bg: #dee9f3;
--theme-accent-dark: #2a5178;
```

Seven hardcoded specialty palettes exist (Cardiology `#9E4160`, Geriatrics
`#3E7D5C`, Endocrinology `#9A6B24`, Neurology `#6B5AA8`, Orthopedics
`#33608D`, Pulmonology `#2E7D80`, plus each with matching `accentBg`/
`accentDark`/gradient/icon/description). This is entirely hospital-specific
branding — see §10.

Helper classes exist for consuming these three vars:
`.theme-bg-accent`, `.theme-text-accent`, `.theme-border-accent`,
`.theme-bg-accent-dark`, `.theme-text-accent-dark`, `.theme-bg-accent-bg`,
`.theme-border-accent-bg`, `.theme-bg-hover` (index.css:151-176).

### Fonts

```css
--font-sans: "Outfit", ui-sans-serif, system-ui, sans-serif;
--font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, monospace;
```
Loaded via Google Fonts `@import` at the top of `index.css` (weights
300/400/500/600/700 for Outfit; 400/500/600 for JetBrains Mono).

**However**, `App.tsx` — the largest single surface in the app — does not
use `--font-sans` at all. Its root `<div>` hardcodes
`fontFamily: "system-ui,-apple-system,sans-serif"`, and its header/nav bars
hardcode `fontFamily: "Segoe UI, Tahoma, Geneva, Verdana, sans-serif"`
(`App.tsx:338,352,463`). So the "real" typeface in daily use is whatever
`Outfit` cascades into from Tailwind-class components, while big chunks of
inline-styled UI silently use the system font stack instead.

### Type scale, spacing, radii, shadows, breakpoints — **not centralized**

This is the honest finding for this section: **there is no defined type
scale, spacing scale, radius scale, shadow scale, or breakpoint list
anywhere in SIMA.** Tailwind v4's defaults are available (since `@theme`
only overrides colors and fonts), but most of the app doesn't use Tailwind
utility spacing/radius classes either — it uses raw inline `style={{}}`
objects with one-off pixel values. Examples from `App.tsx` alone:
`padding: "10px"`, `borderRadius: "8px"` vs `"10px"` vs `"6px"` vs `"50%"`
used interchangeably a few lines apart, `fontSize: "12px"` vs `"12.5px"`
vs `"13px"` vs `"11.5px"` for what's visually the same size of text. The
one hard breakpoint in the app is a single magic number,
`window.innerWidth <= 820`, used to flip between desktop and mobile-drawer
navigation (`App.tsx:83-89`) — not a CSS breakpoint, a JS conditional
re-evaluated on `resize`.

Net: **the color and font tokens are genuinely centralized and reusable.
Everything else (spacing, radius, shadow, type scale) is not — it's
ad hoc per component and would need to be designed from scratch,** not
extracted, if the polyclinic app wants a real scale.

---

## 3. App shell

There is no sidebar. The authenticated layout (`App.tsx:336-1235`, once
`currentUser` is set) is a fixed **two-row top-nav shell**, not a sidebar
layout:

- **Row 1 — global bar** (`App.tsx:341-452`, 48px tall, `#1f2e3e` background):
  hamburger menu (mobile only) → `SimaLogo` → role badge + user name →
  global patient search input → API-health pill → "Clear Chart" (context
  action) → "Print"/"Secure" labels (decorative, no handlers) → Log Out →
  circular initials avatar.
- **Row 2 — workspace tab bar** (`App.tsx:454-884`, 44px tall,
  `--theme-accent-dark` background, **hidden below 820px** in favor of a
  slide-out drawer): a row of buttons, each conditionally rendered by role
  (see below), that set `viewMode` directly — this *is* the navigation.
  Also hosts a "My Tools" dropdown (Template Manager / Test Manager / My
  Locations) and, admin-only, a live specialty switcher `<select>`.
- **Mobile nav** (`App.tsx:886-990`): a full replacement slide-in drawer
  (not a responsive collapse of Row 2 — a separately coded block) triggered
  by the Row 1 hamburger.
- **Page container:** `<main>` with `padding: isMobile ? "12px" : "24px 32px"`,
  swapped per `viewMode` via a long `viewMode === "x" ? <A/> : viewMode === "y" ? <B/> : ...` chain (`App.tsx:994-1225`) — not a route table, a manual ternary cascade.
- **Breadcrumbs:** none exist anywhere in the app.
- **Footer:** a thin static bar with the product tagline and a "HIPAA-structured
  exchanges ready" badge (`App.tsx:1228-1234`) — copy/compliance-badge
  content, not functional.

### Navigation + role filtering

Navigation items are **not** data-driven from a config array — each tab
button is a separate JSX block in `App.tsx`, individually wrapped in a
role check:

```tsx
{currentUser?.role !== "secretary" && ( <button onClick={() => setViewMode("patients")}>...Patient Registry</button> )}
{currentUser.role === "admin" && ( <button onClick={() => setViewMode("admin_console")}>...Admin Console</button> )}
{(currentUser.role === "admin" || currentUser.role === "pharmacy" || currentUser.role === "nurse") && ( ...Pharmacy... )}
{(currentUser.role === "admin" || currentUser.role === "doctor" || currentUser.role === "nurse") && ( ...Care Queue... )}
```
(`App.tsx:470,570,596,648`, duplicated again for the mobile drawer at
`913-948`.) The five roles are `admin | doctor | secretary | pharmacy |
nurse` (`src/components/SignIn.tsx:9`, matching the `profiles_role_check`
CHECK constraint in the DB).

On top of the nav filtering, a **second, independent enforcement layer**
exists — a `useEffect` "Permission Guard" (`App.tsx:211-241`) that watches
`viewMode` and force-redirects if a role lands on (or manually types a
state into) a view it's not allowed to see, e.g. a secretary landing on
`"patients"` gets bounced back to `"calendar"`. So role-gating happens
twice: once by not rendering the nav button, once by refusing to render
the destination even if reached another way. There is **no server-side
route guard** for this — it's client-side UI gating only; the real
authorization boundary is Postgres RLS.

---

## 4. Component inventory

**Headline finding: SIMA has no shared/reusable UI component layer.**
`src/components/` contains 15 files, and all but one are full-page
feature modules (`export default function X({ currentUser }) {...}`,
each 200–7,900 lines) — not composable atoms. There is no `Button.tsx`,
`Modal.tsx`, `Input.tsx`, `Table.tsx`, `Card.tsx`, etc. Every screen
builds its own buttons/modals/inputs inline. This is the single biggest
gap to fill for the polyclinic app if you want an actual component
library rather than another set of monoliths.

| Path | What it is | Verdict |
|---|---|---|
| `src/components/SimaLogo.tsx` (127 lines) | Logo `<img>` wrapper with size presets (`xs/sm/md/lg/xl`) and a cascading `onError` fallback chain (`/logo.svg → logo.png → logo.jpg → logo.jpeg → logo-{dark,light}.svg`) | **Reusable with changes** — the size-preset/fallback pattern is worth keeping; the SIMA branding/asset paths must be replaced |
| `normalizeRole()` — `src/components/SignIn.tsx:12-19` | Pure function mapping loose role strings (`"physician"`, `"administrator"`, etc.) to the 5 canonical roles | **Reusable as-is** (adjust the role list if the polyclinic app's roles differ) |
| Date helpers — `isoToDDMM`, `ddmmToIso`, `formatDateDDMMYYYY`, `formatMRNDisplay`, `stripHtmlTags` — `src/components/PatientsDirectory.tsx:61-73,206-243` | Small pure utility functions (ISO ↔ dd/mm/yyyy conversion, MRN display formatting, HTML stripping) | **Reusable as-is** — no DB or React dependency, easy to lift into a `lib/` module |
| Fuzzy name matching — `editDistanceLte`, `tokenMatchesWord`, `nameMatchesQuery`, `toTitleCase` — `src/components/PatientsDirectory.tsx:79-119` | Edit-distance-tolerant name search (handles skipped middle names, small typos) used to power the patient search box | **Reusable as-is** — genuinely useful, self-contained algorithm |
| `VisitNotesProvider` / `useVisitNotes` — `src/components/VisitNotesManager.tsx:107-459,459-462` | React Context provider for cross-component visit-note state | **Hospital-specific** — the pattern (context provider for shared cross-tab state) is fine, but the content is clinical-domain |
| `ClinicalFormRenderer` — `src/components/VisitNotesManager.tsx:620+` | Renders structured clinical assessment forms (e.g. GAD-7) from a schema | **Hospital-specific**, leave behind |
| `AdminConsole.tsx`, `PatientsDirectory.tsx`, `PharmacyManager.tsx`, `ClinicCalendar.tsx`, `DashboardManager.tsx`, `CareQueue.tsx`, `BedBoard.tsx`, `ScheduleManager.tsx`, `TemplateManager.tsx`, `TestManager.tsx`, `LocationsManager.tsx`, `ReportDashboard.tsx`, `ResetPassword.tsx` | Full-page feature modules, each self-contained (own state, own markup, own Supabase calls) | **Hospital-specific / rebuild** — not componentized enough to lift pieces out cleanly; treat as *structural pattern reference* only (see §5), not as reusable code |
| `SignIn.tsx` (631 lines) | Login screen + `SPECIALTIES` marketing content + `normalizeRole` + `UserSession` type | **Mixed** — the auth logic and `UserSession`/role type are reusable as-is; the `SPECIALTIES` array (hospital department branding, hardcoded gradients) should be left behind entirely |

No date-picker, no rich-text editor, no toast/notification component, no
data-table component, and no design-system primitives exist to inventory
beyond what's listed above — this table is the complete list.

---

## 5. Page patterns

### List/table page — closest example: `PharmacyManager.tsx` (inventory tab)

**Important caveat up front:** SIMA has **zero pagination anywhere in the
codebase** (confirmed — no `currentPage`, `pageSize`, `.slice(page...)`,
or pagination component in any file). Every list renders its full result
set and relies on client-side filtering. There is also no dedicated
"patient list/table" screen — the closest thing, `PatientsDirectory.tsx`,
is actually a **search-and-select combobox** feeding into a single-patient
workspace (see the detail-page pattern below), not a browsable table.

The best real example of the requested pattern — search + filter + a
literal `<table>` — is the **Pharmacy inventory tab**,
`src/components/PharmacyManager.tsx`:
- Tab state: `activeTab: "inventory" | "vendors" | "purchases" | "dispense" | "ledger"` (`:150`)
- Data: `inventory` / `vendors` state arrays (`:154-155`), loaded by a
  `fetchInventory`-style function triggered from a `useEffect` on mount
  and again whenever `activeTab` changes to a tab that needs fresh data
  (e.g. `:306` `useEffect(() => { if (activeTab === "purchases") fetchPurchases(); }, [activeTab])`)
- Filtering: local text-search state filtered client-side against the
  already-fetched array (same pattern as `PatientsDirectory`'s
  `filteredPatients`, `:2939-2952`) — no server-side `WHERE`/`ilike` query,
  no debounce
- Rendering: a plain `<table>` with hand-written `<thead>`/`<tbody>`
  (e.g. purchases table: Date / Vendor / Invoice # / Total columns, `:682-688`)
- **No pagination, no column sort, no page-size control**

### Create/edit form with validation — `PatientsDirectory.tsx`, "new patient" modal

`handleCreatePatient` (`src/components/PatientsDirectory.tsx:2417-2520+`),
triggered from the `isNewPatientModal` state (`:446`) via a `<form
onSubmit={handleCreatePatient}>` (`:6914`). End-to-end shape:
1. **Required-field checks** — trims and checks first name / surname aren't empty; shows a toast and returns early if not (`:2419-2422`)
2. **Format validation** — birth date must match `dd/mm/yyyy` via regex, then is decomposed and re-validated as a real calendar date (rejects Feb 30, future dates, pre-1900 dates) before being converted to ISO for storage (`:2425-2436`)
3. **Normalization** — every name field is run through `toTitleCase` before use (`:2439-2441`)
4. **Client-side duplicate guard** — cross-checks the new patient's name+DOB and name+phone against the already-loaded `patients` array, blocking the submit with a toast naming the existing match and its MRN if found (`:2444-2458`) — this is the **same identity rule the DB also enforces** via the `patients_identity_unique` index, so validation is duplicated client-side for a fast UI error before the DB round-trip would reject it anyway
5. **Local ID generation** — a deterministic-ish numeric MRN is generated client-side from the patient's initials + random digits (`:2464-2475`) rather than trusting the DB's `generated by default as identity` sequence — worth noting as an anti-pattern, not something to copy
6. **Submit** — `setSaveLoading(true)`, `supabase.from("patients").insert([payload]).select()`, `try/catch` throws on `res.error`, response row is mapped back into the local `Patient` shape and pushed into local state (not a full re-fetch)
7. No schema-based validation (no zod/yup resolver) — every rule above is hand-written imperative code in the handler

### Detail page with tabs/sections — `PatientsDirectory.tsx`, patient workspace

Once a patient is selected (via the search combobox in the nav ribbon,
`:2972-3058`), the rest of the screen is a tabbed clinical workspace:
- Top-level tabs: `activeWorkspaceTab: "chart_review" | "synopsis" |
  "assessment" | "plan" | "orders" | "medications"` (`:472`)
- A nested second tab row inside Chart Review: `chartReviewSubTab:
  "encounters" | "notes" | "labs" | "lab_trends" | "all_labs" | "imaging"
  | "cardiology" | "procedures" | "surgeries" | "meds" | "note_template"
  | "media" | "photos"` (`:891`) — 13 sub-tabs
- Filters that apply within a tab: `departmentFilter` (Cardiology /
  Internal Medicine / Rheumatology / General / All), `authorFilter`,
  `smartTextSearchQuery` (`:1182-1188`)
- Each tab lazily fetches its own data when it becomes active (same
  `useEffect` + `if (activeTab === "x") fetchX()` pattern as Pharmacy)
- The "Encounter Close & After Visit Summary" flow is a modal launched
  from within this workspace (`:7793+`) — see §8, this is also the closest
  thing SIMA has to a print template

This is a genuinely deep pattern (tabs-within-tabs, per-tab data
fetching, cross-tab derived state like `activeDiagnoses`/`activeOrders`)
but it's entirely bespoke — there's no reusable `<Tabs>` component
underneath it, just conditional rendering on the two state strings.

---

## 6. Data layer

### List page — `fetchPatients` (`PatientsDirectory.tsx:1992-2063`)

```
setIsLoading(true); setErrorMsg(null)
  → supabase.from("patients").select("*")
  → on error: throw
  → on success: map raw rows into the internal `Patient` shape (handles
    multiple possible legacy column names defensively, e.g.
    `item.phone || item.phone_number`), sort by name client-side
    (avoids "query-level sorting crashes" per the inline comment),
    setPatients(mapped), and if nothing is selected yet, auto-select
    the first patient
  → on failure: console.warn, setPatients([]), setErrorMsg(<hardcoded
    string suggesting the user run the setup SQL script>)
  → finally: setIsLoading(false)
```
Called once on mount (`useEffect(() => { fetchPatients(); ... }, [])`,
`:2066-2067`) and manually again from two "Refresh" buttons
(`:3067,3512`). **No cache layer, no invalidation strategy, no
background refetch, no stale-time concept** — "cache invalidation" in
this app just means "call the fetch function again."

### Form — `handleCreatePatient` (`PatientsDirectory.tsx:2417+`, detailed in §5)

Write path: `supabase.from("patients").insert([payload]).select()` →
throw on `res.error` → map the returned row → push into local `patients`
state directly (no re-fetch of the whole list). This is **not** an
optimistic update (it waits for the DB response before touching local
state) but it also **isn't a full re-fetch** — it's a manual local-array
splice using the server's returned row, which is the closest thing to a
cache-update strategy anywhere in the app. No rollback-on-error logic is
needed because state is never touched before the `await` resolves.

### Auth / session / role checks in the UI

- **Session bootstrap**, `App.tsx:139-208`: on mount, calls
  `supabase.auth.getSession()`; if a session exists, fetches the matching
  row from `profiles` by `id`, runs the raw `role` value through
  `normalizeRole()`, and builds a `UserSession` (`{ id, username, name,
  role }`) — falls back to `"secretary"` if the profile fetch fails or
  the role is unrecognized. Also subscribes to
  `supabase.auth.onAuthStateChange` to keep this in sync (e.g. on
  sign-out from another tab) and to intercept the `PASSWORD_RECOVERY`
  event and force the reset-password screen (`:46-54`).
- **Persistence**: the resolved `UserSession` is mirrored into
  `localStorage` under `"medextract_session"` (`:250-256`) — this is a
  convenience cache, not the source of truth; Supabase's own session
  (JWT in its own storage) is what actually re-authenticates on reload.
- **Role checks in the UI** happen in three independent places, not one
  central guard: (1) nav buttons conditionally rendered per role
  (§3), (2) the `useEffect` "Permission Guard" that redirects `viewMode`
  if it's currently pointed at a disallowed view (§3), (3) ad hoc inline
  checks deep inside feature code, e.g. `handleLoadPresetFromCalendar`
  refusing to run for non-doctor/admin roles with a plain `alert()`
  (`App.tsx:283-287`). **There is no `usePermission()`/`<Can>` abstraction**
  — every check re-derives from `currentUser.role` by hand.
- **Real enforcement is server-side**: Postgres RLS policies (67 of them
  in `schema_consolidated.sql`) are the actual security boundary; the
  UI-level role checks above are purely for UX (hiding buttons a user
  couldn't use anyway), consistent with the polyclinic app's own
  documented model.

---

## 7. Localisation and RTL

**None exists.** Confirmed by search: no `i18n` library in
`package.json`, no translation/locale files anywhere in `src/`, no
`dir="rtl"` or logical-CSS-property usage, and no Arabic or French text
in the UI — everything is hardcoded English strings inline in JSX. (An
earlier grep for "rtl/i18n/locale/translate" only matched unrelated
substrings — `transform: translateY(...)` and the `LocationsManager`
component name — not real localization code.) Dates are formatted with
`toLocaleDateString("en-GB")` in a few places, which is a formatting
choice, not an i18n system.

If the polyclinic app needs Arabic/French/RTL (plausible, given it's
described as being for Lebanese polyclinics), **this has to be built from
scratch** — nothing here to extract or adapt.

---

## 8. Print templates

**No real print or PDF generation exists.** Confirmed: no
`window.print()` call, no `@media print` CSS block, no PDF library
(`jspdf`, `react-to-print`, etc.) anywhere in the repo.

The closest thing is the **"After Visit Summary (AVS)" modal**
(`PatientsDirectory.tsx:7793-7927`, reached from the patient workspace),
which is styled to *look* like a printable document — high-contrast
black-border card, `border-4 border-slate-900`, a mock "EMR Document
Code," patient banner, diagnoses list, orders list, a signature/addendum
section — but its "Print" button (`:7912-7921`) does not call
`window.print()` or generate a PDF. It just shows a toast, `"AVS Summary
Document sent to printer!"`, and closes the modal:

```tsx
onClick={() => {
  triggerToast("AVS Summary Document sent to printer!");
  setIsAvsModalOpen(false);
}}
```

There is no invoice template (SIMA has no invoicing feature at all — see
§9), no prescription template, and no report template with real print/PDF
output. The "Print" and "Secure" labels in the top header bar
(`App.tsx:424-427`) are similarly decorative — plain `<span>`s with no
`onClick` at all. **Nothing here to extract** beyond the visual styling
idea (a high-contrast bordered "document card" look, reused for the AVS
mock) if the polyclinic app wants a starting visual reference for its own
real print/PDF implementation.

---

## 9. Existing DDL

Full extraction in [`docs/sima-ddl.sql`](sima-ddl.sql) (structure only,
no data, no hospital-specific tables). Summary:

- **users/staff** → SIMA's `profiles` table: one row per Supabase Auth
  login, `role` is a free-text column with a `CHECK` constraint (not an
  enum, not a separate roles table), auto-populated via an
  `on_auth_user_created` trigger on `auth.users`.
- **patients** → SIMA's `patients` table: numeric `mrn` (identity
  column) as primary key rather than `uuid`; a large flat demographic
  record (23 columns — name parts, contact info, next-of-kin,
  insurance, blood type); a case-insensitive unique index on
  `(first_name, father_name, surname, birth_date)` is SIMA's
  duplicate-patient guard, enforced at the DB level in addition to the
  client-side check in §5.
- **appointments** → SIMA's `appointments` table: FKs to `patients`,
  `profiles` (doctor), `rooms`, and `doctor_locations`. The latter two
  are *not* extracted (out of the requested four entities, and
  `rooms`/`doctor_locations` are supporting tables, not one of
  patients/appointments/invoices/users).
- **invoices → does not exist in SIMA at all.** The only `invoice_number`
  column in the entire schema belongs to `pharmacy_purchases` — a vendor
  purchase-order reference number, unrelated to patient billing. SIMA has
  no billing/invoicing feature or schema whatsoever. Your polyclinic
  app's own `supabase/migrations/0006_billing.sql`
  (`services`/`invoices`/`invoice_items`/`payments`) is original design,
  not something adapted from SIMA — there's nothing here to reconcile it
  against, which also means no naming conflict to worry about.

Left out of the extraction (hospital-specific, per your instructions):
`hospital_floors`, `wards`, `ward_rooms`, `beds`, `admissions`,
`bed_transfers` (the whole hospital ADT block), plus pharmacy inventory
tables and clinical-assessment tables (`clinical_tests`, `visit_notes`,
`patient_vitals`, `patient_lab_results`, etc.) which are domain, not
interface.

---

## 10. What's reusable, what needs rework, what to leave behind

**Reusable as-is:**
- Color + font design tokens (`src/index.css` `@theme` block) — a real,
  centralized, well-thought-out palette. Copy the hex values, drop the
  Google Fonts if you want different typography.
- The five-role model (`admin | doctor | secretary | pharmacy | nurse`)
  and `normalizeRole()` — directly reusable if these roles fit (rename/
  extend the list to match the polyclinic app's actual roles).
- The small pure-function utilities: date formatting, MRN formatting,
  fuzzy name search (`nameMatchesQuery`/`tokenMatchesWord`) — genuinely
  useful, zero-dependency code worth lifting wholesale.
- The two-channel backend split (direct Supabase from the browser +
  Express server for anything needing a service-role key or third-party
  secret) — matches what the polyclinic app's own docs already assume.
- The RLS-as-real-boundary / UI-checks-as-UX-only security model.

**Reusable with real rework:**
- The top-nav app shell *structure* (global bar + workspace tab bar +
  mobile drawer) is a fine layout skeleton, but it needs: URL-backed
  routing (there is none), a data-driven nav config instead of
  hand-duplicated JSX blocks per role, and a real breakpoint/spacing
  system instead of one magic-number media query and per-element inline
  pixel values.
- The list/detail/form *patterns* (§5) are worth following structurally
  (tab state, per-tab lazy fetch, controlled-form + imperative validation)
  but every implementation needs pagination added (none exists anywhere
  today) and would benefit from an actual reusable `<Table>`/`<Modal>`/
  `<Button>` layer, since SIMA has none.
- `SimaLogo.tsx`'s size-preset + fallback-chain pattern is worth keeping
  as a *pattern*; the asset paths and SIMA branding inside it are not.

**Leave behind entirely:**
- `SPECIALTIES` (hospital department branding/gradients) in `SignIn.tsx`.
- All hospital ADT logic and tables (wards, beds, admissions).
- The AVS "print" modal's fake print button — if you want print/PDF,
  build it for real; there's no working implementation to inherit.
- The `motion` dependency (unused dead weight) and the inline-style
  approach used throughout `App.tsx` — pick one styling approach
  (Tailwind, given the tokens already exist) and apply it consistently,
  rather than inheriting the split between Tailwind-class files and
  inline-style-object files.

### Things that will actively fight a multi-tenant SaaS product

- **Single global user/role model.** `profiles` has no `clinic_id` /
  `tenant_id` column at all — SIMA assumes one hospital, full stop. Your
  polyclinic app already routes around this correctly (one Supabase
  project per clinic, per `docs/database.md`), but it means **none** of
  SIMA's auth/profile code can be copied directly — it has to be
  rewritten clinic-scoped, which your existing migrations already are.
- **Hardcoded specialty/department branding** (`SPECIALTIES` array,
  seven fixed medical departments with hardcoded gradients and icons) —
  purpose-built for one hospital's org chart, meaningless for a
  multi-clinic product where each clinic has its own specialties (or none).
- **Product identity confusion**: the repo is named `react-example`, the
  deploy service is named `auracare` (`render.yaml`), the page title/meta
  tags say "SIMA", and `metadata.json` still calls it "Medical Document
  Analyzer" — three different product names layered on top of each other
  from the app's evolution. Nothing to fix on your end, just don't
  inherit any of these three names by accident when copying config.
- **`og:image`/social meta tags point at `https://simalpi.com`
  (`index.html:19,26`)** — a real external hostname for the SIMA product;
  irrelevant to you but flagging since it's a real, live-looking URL
  baked into a file you might otherwise copy wholesale.
- No hardcoded connection strings were found in application code — the
  Supabase URL/key are read from `import.meta.env`/`process.env`
  everywhere in `src/` and `server.ts` (see §11 for the one place an
  actual value does appear).

---

## 11. Secrets and real patient data — action needed before this goes near version control

- **No real patient data found.** `schema_consolidated.sql` is pure DDL
  (verified: zero `COPY`/`INSERT INTO` statements carrying row data,
  other than one small hardcoded reference-catalog seed for
  `clinical_tests` — five rows of generic geriatric assessment
  definitions like "Walking Speed Test," not patient records). No CSV,
  dump, or seed file containing patient records exists anywhere in the
  SIMA repo. `dist/` only contains compiled JS/CSS/icons, no data.
- **`C:\Maleks System\Sima\.env.example` contains real, non-placeholder
  values** — not blank like its other entries:
  ```
  VITE_SUPABASE_URL=https://wpitarmpsnyrrrultvmp.supabase.co
  VITE_SUPABASE_ANON_KEY=sb_publishable_K4-eFQBtLvoC-FuSTrKffQ_typXoOIK
  ```
  The anon key is a Supabase "publishable" key — it's designed to be
  public and is meaningless without RLS being misconfigured — but the
  project URL identifies a live Supabase project, and leaving real
  values in an "example" file is worth cleaning up in SIMA itself
  regardless (I did not modify it, per your instructions — flagging it
  for you to deal with there). **Nothing from this file was copied
  into `reference/`.**
  - `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and the three
    `TWILIO_*` vars in that same file are correctly left blank.
- **`C:\Maleks System\Sima\.env.local` exists and was not opened or
  read** — by its name and by `server.ts`'s own comments, it almost
  certainly holds the real `ANTHROPIC_API_KEY` and
  `SUPABASE_SERVICE_ROLE_KEY` values. It's already `.gitignore`d in SIMA
  (`.gitignore:6`, `.env*` excluded with `!.env.example` as the one
  exception) — just don't move or copy it.
- I checked every file copied into `reference/` for the specific leaked
  values above (URL fragment, publishable-key prefix, etc.) — none are
  present; the copied files only reference env vars through
  `import.meta.env`/`process.env`, never inline.

---

## What was produced

- `docs/sima-interface.md` — this report
- `docs/sima-ddl.sql` — patients / appointments / profiles (users) DDL,
  with a note on the absence of an invoices table
- `reference/src/index.css` — design tokens (§2)
- `reference/src/App.tsx` — app shell (§3)
- `reference/src/supabaseClient.ts` — data-layer client + mock-mode fallback (§6)
- `reference/src/types.ts` — SIMA's core response/type shapes
- `reference/src/components/SignIn.tsx` — auth screen, roles, `SPECIALTIES` (flagged, §10)
- `reference/src/components/PatientsDirectory.tsx` — list/search + detail-with-tabs + form example (§5)
- `reference/src/components/PharmacyManager.tsx` — list/table + tabs + form example (§5)
- `reference/src/components/AdminConsole.tsx` — RBAC-gated admin page + staff-creation form
- `reference/src/components/SimaLogo.tsx` — logo component pattern (branding flagged, §10)

Not included, because nothing exists to copy: i18n/translation files
(§7), print/PDF templates (§8).

No dependencies were installed and no new app was scaffolded, per your
instructions.
