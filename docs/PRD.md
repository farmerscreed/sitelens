# SiteLens — Product Requirements Document

**Version:** 3.0 (supersedes v2.0 and MVP v1.0)
**Status:** Build-ready
**Audience:** Engineering (human or AI), design, founder
**Owner:** Lawrence Okpokiri

---

## 0. How to use this document

This is the single source of truth. It replaces v2 entirely. Hand it to a developer with no verbal context and they should be able to build.

Every requirement has an ID (`F-x` functional, `NF-x` non-functional, `AI-x`, `SEC-x`, `AC-x` acceptance). Deferred work is marked **[LATER]** and must not be built in the first release.

**Four rules that override everything else in this document if there is ever a conflict:**

1. **No client is trusted with money.** Every write touching an expense, a material transaction, a price, or a budget goes through a server-side function — never a direct insert from the app.
2. **Every fact has a source and a confidence.** Manual entry today, AI inference tomorrow, through the same columns. If a feature needs the record's shape changed to fit AI, the design is wrong.
3. **AI proposes, humans dispose.** No model output — extracted BOQ, anomaly, reorder suggestion, feasibility result — becomes a committed record on its own. It is a proposal a human accepts, or a discrepancy a human explains.
4. **Quantity comes from the design; price comes from the market.** Material quantities are derived from the BOQ and rarely change. Prices are a separate, editable, dated list. Cost is always computed, never frozen as a guess.

**The build-for-one-then-many principle.** SiteLens is built first for the founder's own ~300-building development, then commercialised. This shapes what we build now versus later:

- **Structural things** — multi-tenancy, the recipe library, per-organisation pricing, the source/confidence columns — are cheap to build in now and agony to retrofit. **Build from day one.**
- **External-user features** — billing, self-service signup, per-customer branding, account administration, the rough-materials "side door" — are cheap to add later and wasteful to build for imaginary users now. **Deferred, marked [LATER].**

The rule is *prepare the foundations, defer the features.*

---

## 1. Executive summary

SiteLens is a construction planning, management and monitoring platform for developers and contractors in Nigeria. It runs as a **mobile app for the field** and a **web application for planning and command**.

The problem is not construction knowledge. It is that the numbers a project runs on — what it should cost, what it actually consumes, how far the money reaches — live in spreadsheets, WhatsApp messages and people's heads, where they cannot be checked against each other. Materials disappear, budgets are guesses, and cash runs dry mid-build because nobody modelled the funding rhythm of a staggered development.

SiteLens replaces guesswork with a single data chain that runs from design to delivery:

```
BOQ  →  Requirement  →  Plan & funding  →  Purchase  →  Delivery  →  Store  →  Usage  →  Progress
```

Every link measures against the one before it. That is what makes the system data-driven rather than a reporting tool: each stage has an *expected* value it can test reality against, and every gap between expected and actual is where theft, waste, or a bad plan reveals itself.

**The three original pillars still hold** — progress visibility, money control, proof of work — but v3 adds the layer beneath them: **a planning and cost-control engine driven by the Bill of Quantities.**

**The long game:** every day of use generates labelled site imagery tied to verified material transactions, tied in turn to a known design requirement. Over a year that becomes a proprietary dataset of Nigerian construction reality that no competitor can buy, and it is what makes the camera-based verification in Section 12 possible.

---

## 2. The core model — the one idea that keeps this simple

Everything in SiteLens reduces to three concepts. Get these right and nothing else is hard.

### 2.1 Types, Buildings, Batches

**A building TYPE is a recipe, defined once.**
"Terrace Type A" is a recipe: its BOQ (4,800 blocks, 320 bags of cement, and so on), its stages (Foundation → DPC → Lintel → Roof → Finishes), and its non-material costs. You digitise this **once per type**, not once per building. A 300-building project with 8 types means the hard work happens 8 times.

**A BUILDING is a copy of a recipe.**
Building #17 is "a Terrace Type A." On creation it inherits the whole recipe automatically — material requirements, stages, cost. You never re-enter a BOQ per building. Each building carries its **own current stage**, so Building #3 can sit at Roof while Building #8 sits at Foundation. "Buildings at different stages" is just a stage label on each copy — no special machinery.

**A BATCH and a PHASE are named groups of buildings.**
"Phase 1" is 50 specific buildings. "Batch 1" is the first 5 you start. A building carries a phase label and a batch label. That is all a batch is — a grouping. No cleverness.

So the founder's entire project — 300 buildings, under 10 types, phased and staggered — is simply: *a few recipes, many copies, grouped into batches, each copy at its own stage.* That sentence is the whole data model.

### 2.2 Why this scales to external users unchanged

A type is a type whether you have 8 or 800. What changes for large external developers is *organisation*, not structure: they need folders, search, and "duplicate and tweak" on the recipe library. Those are built in from day one (Section 6) at near-zero cost, so onboarding a developer with 200 house types later is a data-entry exercise, not a rebuild.

---

## 3. Strategy and sequencing

### 3.1 Release phases

| Phase | Name | Contents | Target |
|---|---|---|---|
| **P1** | Plan & trust the phone | Full BOQ engine, recipes, buildings/batches, price list, the board, feasibility planner, question layer, core field reporting, money control, photo forensics, receipt/BOQ OCR, client portal | First release, on founder's own project |
| **P2** | Trust the gate | Gate camera: person counting, vehicle/delivery capture, QR badge attendance | +4–6 months |
| **P3** | Trust the stack | Material counting at offload, progress estimation from imagery, PPE detection | +9–15 months |

### 3.2 What is deliberately deferred

**[LATER]** Billing, subscription tiers, self-service signup, account administration, per-customer branding. The founder is organisation #1 and does not charge himself.

**[LATER]** The rough-materials "side door" (letting a user plan from an informal materials list instead of a real BOQ). The founder has proper BOQs; this door is for external small builders and is a selling-stage feature.

**[LATER]** Invoices and payment certificates, equipment maintenance, payroll, accounting sync, subcontractor portals, drone/IoT.

### 3.3 Cuts carried over from v2

- **No selfie attendance / no face recognition, ever.** Biometric processing under the NDPA, requires a DPIA, serves none of the pillars, and a workforce that believes it is under facial surveillance will defeat the system. Attendance is anonymous headcount plus optional QR badge. Permanent product constraint (SEC-9).
- **No Socket.io / real-time.** Nothing in P1 needs sub-second updates. Polling and push are enough.
- **The project-level Gantt is replaced** by the building × stage board (Section 8), which is the natural progress view for a multi-building development.

---

## 4. Users and the two-lens design

| Persona | Device | Primary lens | What they do |
|---|---|---|---|
| **Admin / MD / Developer** | Laptop + phone | **Web** | Plan funding, model feasibility, run the board, edit prices, ask questions, control money |
| **Project Manager** | Phone + laptop | Both | Approve reports and expenses, watch the board, manage batches |
| **Site Engineer** | Low-end Android, poor network | **Mobile** | Daily reports, photos, log materials in/out, mark building stages complete, attendance |
| **Client / Owner** | Phone | **Web (portal)** | Read-only progress and summary spend, no login |

**The two-lens split is a core design decision, not a convenience:**

- **Mobile is the field lens** — capture, offline-first, fast, small screen. Nobody plans a phase on a phone.
- **Web/desktop is the command lens** — the board, the feasibility planner, the financials, the BOQ editor, the price list, the question box. Dense tables and complex financials belong on a monitor.

Same data underneath, two windows. The engineer marks a stage done on his phone; the board rearranges on the MD's screen. Architecture supports this natively (Section 5).

**The adoption reality still governs everything:** the site engineer gains work and no benefit, so his daily flow is the single most optimised path in the product, measured, and a bug if it exceeds 90 seconds. If the engineer won't use it, nothing else matters.

---

## 5. Technical architecture

### 5.1 Stack

| Layer | Choice | Notes |
|---|---|---|
| Database | **Supabase Postgres**, region `eu-west-2` (London) | PostGIS + pgvector + pg_cron enabled |
| Tenancy | **Row Level Security on every table** | Not application-layer filtering |
| Business logic | **Postgres `SECURITY DEFINER` functions + Supabase Edge Functions** | All money, price, geofence, and BOQ-commit writes |
| Object storage | **Cloudflare R2** | Zero egress — see 5.3 |
| Mobile | **Flutter** (Android 8+) | Drift/SQLite local store, offline-first |
| Web | **Next.js + Tailwind** | Command console + client portal |
| Auth | **Supabase Auth**, phone OTP via Termii | JWT carries `active_org_id` + `role` |
| AI routing | **OpenRouter** in front of all LLMs | One key, swap models by config — see Section 11 |
| Spreadsheet parsing | **SheetJS** (server-side) | Excel BOQ ingestion, no AI needed |
| Maps | Mapbox | |
| Transactional email | **Resend** on `notify.<domain>` | Never through Workspace — see 5.4 |
| Human email | **Google Workspace** on root domain | See 5.4 |
| Notifications | WhatsApp Business API (primary), SMS (fallback), push, email (tier 3) | |
| Jobs/queue | Postgres table + `pg_cron` | No Redis in P1 |
| ML training/deploy **[P2]** | Roboflow | Annotate → train → edge deploy |
| Edge inference **[P2]** | Jetson Orin Nano or RPi 5 + Hailo-8L, solar-powered | On-site — see Section 12 |

**Why London:** Supabase has no African region (Cape Town was withdrawn). West African subsea cables route north to Europe, so Port Harcourt → London (~90–130 ms) is the lowest-latency option available and beats Cape Town routing. Fine for an offline-first app.

**Why managed, not the founder's Hetzner box:** self-hosted Supabase on one VPS is right for internal tooling and wrong for a commercial system of record — no automated point-in-time recovery, no HA, one bad upgrade from destroying a customer's financial history. Use managed Supabase and **enable PITR (non-negotiable).**

### 5.2 Multi-tenancy

Identity is separated from membership so one person can serve multiple organisations (common for PMs and QSs).

```
auth_user (global identity, phone unique globally)
   └── membership (user × org, holds org role)
         └── project_member (membership × project, holds project role override)
```

JWT carries `active_org_id`; RLS filters on it; switching org reissues the token.

### 5.3 Media storage — two rules that cannot be deferred

**Never destroy the original.** Each capture produces three artefacts:

| Derivative | Size | Purpose | Retention |
|---|---|---|---|
| `thumb` | ~50 KB | Lists, portal timeline | Forever |
| `display` | ~400 KB, watermarked | Full-screen viewing | Forever |
| `original` | Full resolution, EXIF intact | Forensics + model training | 24 months, then cold |

Compressing everything to 500 KB (as v1 specified) permanently destroys the resolution needed to count blocks later. Photos taken in month one at 500 KB are worthless as training data forever.

**Zero egress.** Cloudflare R2, not S3-style storage. Training pipelines and portal timelines re-read the same images thousands of times; egress fees on that pattern become the biggest line in the cost base. R2 charges nothing for egress. Buckets private; access via 15-minute signed URLs issued by an Edge Function after a permission check; object keys are opaque UUIDs.

### 5.4 Email

Google Workspace is for humans and must never send application mail — hitting the recipient cap silently drops mail, and one spam complaint against a SiteLens notification damages the domain reputation used for banks, investors and government.

| Domain | Service | Purpose |
|---|---|---|
| `<domain>` | Google Workspace | hello@, support@, billing@ — human correspondence |
| `notify.<domain>` | Resend | All application mail — own DKIM, own reputation |

Root SPF includes Google only; subdomain has independent SPF/DKIM; DMARC on root at `p=quarantine` with explicit `sp=`; app mail `Reply-To` points to `support@<domain>`. Email is tier three in this market — the engineer never reads it. It carries the portal link, receipts, statements and security events; WhatsApp and SMS carry everything operational.

---

## 6. The BOQ engine and recipe library

This is the heart of v3. It turns SiteLens from a reporting app into a control system.

### 6.1 BOQ import — two lanes

- **F-BOQ-1 (Excel lane).** User uploads `.xlsx`/`.xls`/`.csv`. Server parses cells directly with SheetJS — **no AI needed.** A mapping screen asks the user to point out which columns are item, quantity, unit and rate. The mapping is remembered per organisation so the next upload in the same format maps automatically.
- **F-BOQ-2 (PDF lane).** User uploads a PDF BOQ. A vision model (Section 11) extracts rows into the same structure. Because a QS-produced BOQ is orderly, accuracy is high — but every extracted row is a **proposal** the user confirms. Never auto-committed.
- **F-BOQ-3 (item mapping + memory).** The genuinely hard part of BOQ import is that no two QSs name items the same way ("Cement (50kg)" vs "Portland cement bags"). The first time the system sees an unfamiliar item it asks the user to map it to a catalogue material once; the alias is stored (`material_aliases`) and recognised automatically thereafter. After a few projects the system maps almost everything on its own.
- **F-BOQ-4 (attach to a type).** A confirmed BOQ import populates a building type's recipe (`type_boq_items`) — item, quantity, unit, and optionally the stage at which the material is consumed. Quantities only. **No prices are stored here** (Rule 4).
- **F-BOQ-5 (raw file retained).** The original Excel/PDF is stored in R2 and linked, so the source is always auditable against the digitised version.

### 6.2 The recipe (building type)

- **F-TYPE-1.** A building type has: name, category (Terrace / Duplex / G+3 / Bungalow / custom), description, an ordered list of **stages** (`type_stages`), material requirements per stage (`type_boq_items`), and non-material cost lines per stage (`type_stage_costs` — labour, plant, other).
- **F-TYPE-2 (scale-ready library).** Types live in a searchable, **foldered** library (`type_folders`). Foundational for external users with hundreds of types; the founder's 8 need no folders but the structure exists.
- **F-TYPE-3 (duplicate and tweak).** Any type can be duplicated and edited ("Terrace Type A, bigger kitchen") without touching the original.
- **F-TYPE-4 (versioning).** Editing a type that already has buildings created from it creates a new **version**; existing buildings keep the version they were stamped with, so historical requirements never silently change. New buildings use the latest version.

### 6.3 The price list — quantity/price separation (Rule 4)

- **F-PRICE-1.** A per-organisation price list holds the current unit price of every catalogue material (`material_prices`), editable by Admin.
- **F-PRICE-2 (dated history).** Every price change is a new dated row, never an overwrite. Current price = latest row with `effective_from ≤ today`. Old reports show the price that applied then; no retro-confusion.
- **F-PRICE-3 (one change re-costs everything).** Because cost is always quantity × current price, computed live, changing one block price instantly re-costs every terrace, every batch, and the whole 300-building plan. Management never chases old numbers.
- **F-PRICE-4.** Non-material costs (labour, plant) per stage are stored as editable naira estimates on the recipe, so total building cost = materials (qty × live price) + non-material estimates. Both editable by management.

---

## 7. The planning module (web-first)

A distinct part of the app, on the big screen, because it is complex financial work.

### 7.1 Front door — "What cash do I need, and when?" (funding-required mode)

This is the planner's default view, because a staggered development is fundamentally a funding-rhythm problem.

- **F-PLAN-1 (inputs).** The user specifies: the set of buildings to deliver (e.g. 40 × Type A + 10 × Type B), the target stage for each (roof / finish), and the batching schedule — which buildings start when, and the trigger to start the next batch (e.g. "Batch 2 starts when Batch 1 reaches DPC").
- **F-PLAN-2 (the cash-flow timeline).** From the recipes (cost per stage per type), current prices, and the batch schedule (which places each building's stages on a calendar), the planner produces a **period-by-period cash requirement** — how much money must be available each week/month as batches move through stages and consume materials and labour.
- **F-PLAN-3 (the numbers that drive decisions).**
  - **Peak funding requirement** — the deepest point the cash curve reaches (the money you must be able to cover at the worst moment).
  - **Total funding to complete** the target at current prices.
  - **The funding schedule** — "you need ₦X by week 5, ₦Y more by week 9," matched to when each batch hits each stage.
- **F-PLAN-4 (staggering saves cash).** Because batches are staggered, the planner shows how spreading starts flattens the peak — "start 5 not 10 and your peak requirement drops from ₦A to ₦B, at the cost of Z extra weeks." This is the core trade-off a developer lives on.

### 7.2 Second door — "How far does my cash go?" (max-delivery mode)

- **F-PLAN-5.** Inputs: available cash (a pot, optionally with scheduled future inflows over time) and a target stage. Outputs: how many units of each type can be delivered, and/or how far (which stage) a fixed count reaches. Same cost model as 7.1, run the other way.

### 7.3 Scenarios

- **F-PLAN-6.** Plans are saved as named scenarios (`plans`, `plan_lines`) so the user can compare "5-at-a-time vs 10-at-a-time" or "at today's prices vs +15% cement" side by side. Inputs are stored; results are computed live so a price change updates every saved scenario.

### 7.4 The question layer

- **F-ASK-1.** A plain-language question box, backed by the ingested data (RAG over structured tables + reports via pgvector). It answers questions that are **arithmetic over the data**:
  - "If cement rises 15%, how many fewer units can I finish this phase?"
  - "Which batch is bleeding money against its BOQ?"
  - "What's my peak cash requirement if I start Batch 3 next month?"
- **F-ASK-2 (honest boundary).** The system **informs** judgment calls ("should I start Batch 3?") with hard numbers but does not make them — those depend on things not in the data (market read, a buyer who might pay early, a contractor's reliability). Data-driven, not decision-replacing. Consistent with Rule 3.

---

## 8. The board — every building at its stage

- **F-BOARD-1.** The command view (web) shows every building as a card, arranged in columns by construction stage (Not started → Foundation → DPC → Lintel → Roof → Finishes → Done). At a glance: how many buildings sit at each stage, which type each is, which batch/phase it belongs to.
- **F-BOARD-2 (filter and group).** Filter by phase, batch, type, or stage. Group the board by batch to watch a batch move as a unit.
- **F-BOARD-3 (manual batch progression — deliberate).** The system does **not** auto-start the next batch when a trigger stage is reached. It surfaces the state ("Batch 1 has reached DPC") and shows the **cost/material consequence** of starting the next batch, then a human presses "Start Batch 2." Real sites are messy — blocks late, rain, tight cash — and the judgment must stay with a person watching the board. Automating it produces software people fight.
- **F-BOARD-4 (stage completion from the field).** The engineer marks a building's stage complete on mobile (`building_stage_progress`); the board updates. Stage completion is an approvable event for the PM where the org requires it.
- **F-BOARD-5 (requirement vs actual per building).** Each building card shows required materials for its completed stages (from its recipe) versus actually consumed (from material OUT tagged to that building) — the overrun/underrun visible per building, per stage.

---

## 9. Field operations (mobile)

The unit of field work is the **building**, not just the project.

### F-9 Daily report
- F-9.1 One report per project per day; a second submission for the same date amends and is versioned, never overwritten.
- F-9.2 Fields: date (defaults today; backdating limited to 3 days and flagged), **which building(s) worked on**, work summary, manpower by trade, weather (auto online / manual offline), issues, task/stage progress.
- F-9.3 3–20 photos, captured in-app only (gallery import disabled to prevent old/borrowed images).
- F-9.4 Each photo stamped at capture with GPS, device time, project + building name, and a server sequence number; stamp burned into `display`, `original` kept unmodified.
- F-9.5 Geofence checked at capture. Outside the fence, capture is allowed but **flagged**, not blocked (blocking breeds workarounds; a flagged photo is better evidence than none). Reports with flagged photos require PM approval.
- F-9.6 Fully offline (Section 13).
- F-9.7 PM/Admin approves, rejects with reason, or requests amendment.

### F-10 Materials
- F-10.1 Admin maintains the org catalogue: name, unit, reorder level, standard rate.
- F-10.2 **IN**: material, quantity, unit price, supplier, budget line, **building or batch it's for**, waybill photo (mandatory), delivery-note number.
- F-10.3 **OUT**: material, quantity, **building + stage it was used on**, purpose note.
- F-10.4 Running balance per project per material, maintained by a DB function under row lock — never recomputed on read.
- F-10.5 An OUT that would drive balance negative is rejected. Negative stock is always an error or a theft signal.
- F-10.6 Balance below reorder level alerts PM + Admin. **Reorder suggestions are BOQ-aware** (Section 10.3): the system knows remaining requirement, not just current stock.
- F-10.7 Transfers between buildings/projects as paired OUT/IN.
- F-10.8 Immutable; corrections by void-with-reason, which reverses the balance effect and is logged.
- F-10.9 **Supplier confirmation** (highest-leverage anti-fraud, cheap): supplier receives an SMS link to confirm the delivery they were paid for; an unconfirmed delivery is a live flag.

### F-11 Expenses
- F-11.1 Fields: budget line (mandatory), **building (optional)**, category, amount, description, paid to, method, receipt photo.
- F-11.2 **Approval thresholds, per-org configurable.** Default: Engineer ≤ ₦50,000 (needs PM approval); > ₦250,000 needs Admin. Unapproved = *committed*, not *spent*.
- F-11.3 Immutable; void-with-reason, Admin only, audited.
- F-11.4 Receipt OCR pre-fills amount/date/payee and cross-checks the typed amount against the receipt (AI-2).

### F-12 Attendance
- F-12.1 **No selfies, no face recognition** (SEC-9).
- F-12.2 Foreman records daily headcount by trade at shift start, within the geofence.
- F-12.3 Optional QR badge scan for named workers (printed card, not biometric).
- F-12.4 Headcount auto-reconciled against the daily report's manpower figure; divergence > 20% flagged. Attendance is the single source of truth for labour; the report reads from it.
- F-12.5 Every attendance record carries `source` (`manual`/`qr`/`camera`/`import`) and optional `confidence` so camera counting (P2) slots in with no schema change.

### F-13 Client portal
- F-13.1 Unique tokenised URL **per recipient**, individually revocable.
- F-13.2 Link **plus a 6-digit PIN** (shared separately); a forwarded link alone must not expose financials.
- F-13.3 Expires 90 days, renewable, revocable instantly.
- F-13.4 Shows: overall progress, photo timeline, milestone status, summary spend vs budget (line-item detail only if enabled per link), overdue items.
- F-13.5 Every access logged (timestamp, IP); Admin sees last-opened.
- F-13.6 Never exposes supplier names, unit prices, or individual worker data.

---

## 10. The data chain — requirement vs actual

This is what makes the system data-driven. Each link measures against the previous one.

```
BOQ requirement → Purchase plan → Delivery → Store → Usage → Progress
```

### 10.1 The comparisons (mostly query logic, not new tables)

- **Requirement** = Σ `type_boq_items` across all buildings, by material, by stage, by batch/phase (from recipes × building instances).
- **Ordered/delivered** = material IN, tagged to building/batch.
- **In store** = `material_balances`.
- **Used** = material OUT, tagged to building + stage.

### 10.2 The checks that catch loss

| Check | Meaning |
|---|---|
| Delivered > requirement for a building | Over-ordering, or a wrong BOQ — flag |
| Used > requirement for a completed stage | Material overrun / loss — flag, **at the pour, not weeks later** |
| Used < requirement but stage marked done | Either the claim is false or the BOQ is generous — flag |
| Consumption ratio vs learned norm (e.g. cement per m³) | Independent overrun signal |

### 10.3 BOQ-aware procurement (the AI ordering advice)

Because the system knows **remaining requirement** (recipe minus already-consumed) and the **schedule** (which batch hits which stage when) and **current stock**, it can advise: *"Batch 2 reaches slab in ~2 weeks and needs 300 bags; you hold 90; order 210 now."* Trustworthy because it is arithmetic over the BOQ, not a guess. A **proposal** the user acts on (Rule 3).

### 10.4 Material draw-down as an independent progress check

Reported progress and material consumption are two independent measures. If a building's ground floor is claimed 100% done but has drawn only 60% of its BOQ materials, one of those facts is wrong. Neither can lie alone — this cross-check is impossible without the BOQ as reference, and it is a core reason the BOQ engine is P1, not P2.

---

## 11. AI architecture

### 11.1 The principle

Every observable fact — headcount, quantity, progress, an extracted BOQ row — stores `value`, `source` (`manual`/`qr`/`ocr`/`camera`/`model`/`import`), `confidence`, `model_id`, `verified_by`. An AI feature is never a new subsystem — it is a new *source* writing into existing columns. This is why cameras (P2) need no migration.

### 11.2 The inference loop

```
capture → inference → proposal → human verdict → verified record
                                       └→ training label
```

Every human verdict on a proposal is a labelled example. The product generates its own training data as a by-product of normal use — the flywheel — which only works if the loop is in the schema from day one (`ai_inferences` exists in P1 even while little writes to it yet).

### 11.3 The model router

Model choice is **config, not code.** All LLM calls go through **OpenRouter**, so any model can be swapped with a one-line change, one bill, one key. Prices and model quality move monthly — never bake a model name into the app.

Tasks fall into three buckets, priced very differently:

| Bucket | Task | Approach | Rationale |
|---|---|---|---|
| **A — no model** | Duplicate photos (AI-1) | Perceptual hash on the server | Free. Highest-value anti-fraud feature. Build first. |
| **A — on-device** | Photo quality gate (AI-3) | Tiny classifier on the phone | No API cost |
| **B — vision, cheap** | Excel BOQ (F-BOQ-1) | SheetJS cell parsing | No AI at all |
| **B — vision, accuracy-led** | PDF BOQ (F-BOQ-2), receipt OCR (AI-2) | Vision LLM | Accuracy matters; token cost is trivial at this volume, so **choose on accuracy, not price** |
| **C — reasoning, low-volume** | Weekly summary (AI-4), anomaly notes (AI-5), question layer (F-ASK-1) | Strong LLM, runs nightly or on demand | Rare calls, high value — afford quality |

**Default model assignments (verify prices at build time — they change):**

| Task | Default | Note |
|---|---|---|
| Duplicate photos | none (hash) | free |
| Photo quality gate | on-device | free |
| Excel BOQ | SheetJS | free |
| PDF BOQ + receipt OCR | Start on a strong vision model (Claude/Gemini); **benchmark a cheap model, e.g. Kimi K2.6, on 100 real Nigerian BOQs/receipts before switching** | benchmarks are run on clean US docs; test on your actual crumpled inputs |
| Weekly summary, anomaly notes | Kimi (cheap, batched nightly) | quality is sufficient for summarising |
| Question layer, reasoning | Strong model (Claude / Kimi top tier) | low volume, high value |

Context caching on repeated system prompts cuts input cost heavily and should be used on all high-volume calls.

### 11.4 P1 AI features (no cameras)

| ID | Feature | Approach |
|---|---|---|
| AI-1 | Duplicate photo detection | Perceptual hash, 90-day window. No model. **Build first.** |
| AI-2 | Receipt/waybill OCR | Vision LLM → structured JSON; cross-checks typed amount/quantity |
| AI-3 | Photo quality gate | On-device blur/darkness/obstruction classifier |
| AI-4 | Weekly digest for the MD | LLM over the week's reports → one paragraph |
| AI-5 | Spend anomaly detection | Statistical outliers, supplier price drift, odd timing |
| AI-6 | Consumption-ratio checking | Material used vs work done vs learned norms |
| AI-7 | BOQ extraction | PDF → structured rows (F-BOQ-2) |
| AI-8 | Natural-language questions | RAG over structured data + reports (F-ASK-1) |
| AI-9 | BOQ-aware reorder advice | Remaining requirement + schedule + stock → order proposal (10.3) |

### 11.5 Cost discipline

Inference must stay under **5% of ARPU**. Consequences: never run a vision model on every photo (hash runs on all, OCR only on receipts/BOQs, quality gate on-device); batch AI-4/5 into nightly jobs; cache aggressively; store `cost_estimate` on every `ai_inferences` row so unit economics are measurable from day one.

---

## 12. Camera roadmap [P2/P3]

### 12.1 Edge architecture
Unreliable power and slow uplinks make cloud video streaming non-viable. An on-site edge gateway runs detection locally and uploads only **structured events + still frames** (< 5 MB/day/camera); raw video never leaves the site unless requested. Cameras + gateway run on a dedicated **solar + battery** unit sized for 48 h autonomy — generator downtime correlates with the periods theft occurs. Physical security of the equipment is a real, priced risk.

### 12.2 P2 — gate camera
- **AI-10 Person counting (NOT face recognition).** Targets inflated headcount / ghost workers. Counts people crossing the gate line; no faces stored, no identities matched, no biometric template. Avoids the NDPA sensitive-data regime, more accurate in dust and hard-hats, and defensible to the workforce. Where named attendance is wanted, the QR badge supplies identity and the camera supplies the count — **divergence is the signal.**
- **AI-11 Vehicle/delivery capture.** ANPR timestamps vehicle entry; a material IN with no matching vehicle arrival in-window is a strong theft signal.

### 12.3 P3 — material counting
- **AI-12 Delivery counting.** Counts units **at offload** (tractable — units pass one at a time against a stable background), **not stacks** (unreliable — occlusion makes interior a guess). Realistic ceiling 90–96% on clean offloads, worse in rain/dusk. Presented as a **discrepancy flag** ("camera 480, waybill 500 — review"), never as an authoritative quantity. Needs 5,000–10,000 labelled Nigerian-site images per material — exactly what P1/P2 accumulate. Train via Roboflow, deploy to the edge.
- **AI-13 Progress estimation.** Multi-view imagery → structural progress. Research-grade; do not commit commercially until proven.
- **AI-14 PPE compliance.** Helmet/vest detection; often the feature that actually sells the camera package (insurance/HSE).

---

## 13. Offline-first

The hardest engineering problem in the product.

- **13.1 Model.** Local SQLite (Drift) is the source of truth on device; the app never blocks on the network. An outbox holds pending mutations; a sync worker drains it on reconnect.
- **13.2 Identity + idempotency.** All IDs are **client-generated UUIDv7** (time-ordered, no server round-trip). Every mutation carries an `idempotency_key` the server enforces unique. **Without this, a retry over flaky 3G silently creates duplicate expenses** — the most common way offline apps corrupt financial data.
- **13.3 Conflict resolution** (last-write-wins is **not** acceptable for money):

| Record | Strategy |
|---|---|
| Financial (expenses, material txns) | Append-only; never edited, only voided — no conflict possible |
| Daily reports | Versioned; concurrent edits create a version; PM resolves |
| Stage progress | Last-write-wins, losing value kept in audit |
| Attendance | Unique on (project, date, source); second submission amends + versions |

- **13.4 Media sync.** Photos queue separately with own retry/backoff; a report is visible once `thumb`s upload; `original`s continue in background, preferentially on Wi-Fi; local originals purged 7 days after confirmed upload.
- **13.5 Integrity.** Every sync returns a server cursor; client resumes from it; any integrity failure triggers a full project re-baseline, not a partial repair.

---

## 14. Security, privacy, NDPA

Data is stored in London. Under the **Nigeria Data Protection Act 2023**, transferring personal data out of Nigeria is prohibited by default unless the recipient is covered by adequate-protection law or an approved transfer instrument (SCCs, BCRs, code of conduct, certification). Penalties reach **₦10 million or 2% of annual gross revenue**, whichever is higher, plus possible criminal liability. The NDPR 2019 no longer applies; the NDPA + **GAID (20 March 2025)** govern.

| ID | Requirement |
|---|---|
| SEC-1 | Execute Supabase, Cloudflare, Resend, Termii and any inference provider DPAs with SCCs; maintain a processor register |
| SEC-2 | Privacy notice acknowledged at signup, with explicit disclosure of UK storage |
| SEC-3 | Record lawful basis per purpose; worker monitoring relies on documented legitimate interest with a balancing test |
| SEC-4 | **DPIA required before any camera deployment** — complete before hardware is ordered |
| SEC-5 | Monitor the "data controller of major importance" threshold; once crossed, register with NDPC and appoint a DPO |
| SEC-6 | Data-subject rights endpoints; erasure anonymises the actor but retains financial records |
| SEC-7 | Breach-notification workflow with NDPC timelines documented and rehearsed |
| SEC-8 | Retention: media originals 24 months then cold; access logs 12 months; financial records 7 years; badge scans 12 months |
| SEC-9 | **No biometric processing anywhere, ever** — no face recognition, templates, or gait. Person *counting* only. Permanent product constraint |
| SEC-10 | Signed URLs expire in 15 min; object keys opaque UUIDs; buckets never public |
| SEC-11 | Portal links: token hashed at rest, PIN required, per-recipient revocation, full access logging |
| SEC-12 | PITR enabled; restore drill performed and documented quarterly |

Consent from an employee to an employer is legally weak; the design deliberately does not lean on it — anonymous counting plus voluntary badge, face recognition permanently excluded. This is also practical: a workforce that feels surveilled will defeat the system, and their cooperation matters more than their identities.

---

## 15. Non-functional requirements

| ID | Requirement |
|---|---|
| NF-1 | Cold launch < 2.5 s on a 2 GB RAM Android 8 device |
| NF-2 | Daily report completed in < 90 s, measured in-product |
| NF-3 | Full offline function; all mobile reads from local SQLite |
| NF-4 | Sync of one report + 5 photos < 60 s on 3G |
| NF-5 | APK < 40 MB |
| NF-6 | < 15 MB data per engineer per day at default settings |
| NF-7 | Web command console loads < 3 s on 5 Mbps; the board renders 300 buildings without lag |
| NF-8 | 99.5% monthly uptime target |
| NF-9 | Supports 10,000 buildings and 100,000 media/day without redesign |
| NF-10 | Full English + Pidgin UI; architecture ready for Hausa/Yoruba/Igbo |
| NF-11 | All money `NUMERIC`, never float |
| NF-12 | All timestamps `TIMESTAMPTZ`; business dates computed in the org timezone, never UTC-derived (WAT is UTC+1) |
| NF-13 | Feasibility recompute across a 300-building plan returns in < 5 s |

---

## 16. Data model

### 16.1 What v3 adds over v2

Beyond v2's tenancy, media, reports, materials, expenses, attendance, portal, AI and audit tables, v3 adds the planning engine: `type_folders`, `building_types`, `type_stages`, `type_boq_items`, `type_stage_costs`, `buildings`, `building_stage_progress`, `phases`, `batches`, `material_prices`, `boq_imports`, `boq_import_rows`, `material_aliases`, `plans`, `plan_lines`. Material and expense tables gain `building_id`/`stage_id` links so usage can be measured against requirement.

### 16.2 Schema (new and changed tables — v2 tables carried forward unchanged except where noted)

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_cron";

CREATE TYPE fact_source     AS ENUM ('manual','qr','ocr','camera','model','import');
CREATE TYPE stage_status    AS ENUM ('not_started','in_progress','done','blocked');
CREATE TYPE txn_type        AS ENUM ('IN','OUT');
CREATE TYPE approval_status AS ENUM ('pending','approved','rejected','voided');
CREATE TYPE import_status   AS ENUM ('uploaded','parsing','review','confirmed','failed');
CREATE TYPE plan_mode       AS ENUM ('funding_required','max_delivery');

-- ── RECIPE LIBRARY ──────────────────────────────
CREATE TABLE type_folders (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  parent_id  UUID REFERENCES type_folders(id),
  name       VARCHAR(120) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE building_types (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  folder_id   UUID REFERENCES type_folders(id),
  name        VARCHAR(150) NOT NULL,
  category    VARCHAR(50),                 -- terrace | duplex | g+3 | bungalow | custom
  description TEXT,
  version     INT DEFAULT 1,
  parent_version_id UUID REFERENCES building_types(id),  -- version chain
  created_by  UUID REFERENCES memberships(id),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);
CREATE INDEX idx_bt_org ON building_types(org_id) WHERE archived_at IS NULL;

CREATE TABLE type_stages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_type_id UUID NOT NULL REFERENCES building_types(id) ON DELETE CASCADE,
  name             VARCHAR(80) NOT NULL,   -- Foundation | DPC | Lintel | Roof | Finishes
  sequence         INT NOT NULL,
  expected_days    INT,
  UNIQUE (building_type_id, sequence)
);

CREATE TABLE type_boq_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_type_id UUID NOT NULL REFERENCES building_types(id) ON DELETE CASCADE,
  stage_id         UUID REFERENCES type_stages(id),
  material_id      UUID NOT NULL REFERENCES materials_catalog(id) ON DELETE RESTRICT,
  quantity         NUMERIC(14,3) NOT NULL CHECK (quantity > 0),   -- quantity ONLY, no price
  unit             VARCHAR(20) NOT NULL,
  notes            TEXT
);
CREATE INDEX idx_boqitems_type ON type_boq_items(building_type_id);

CREATE TABLE type_stage_costs (             -- non-material costs per stage
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_type_id UUID NOT NULL REFERENCES building_types(id) ON DELETE CASCADE,
  stage_id         UUID REFERENCES type_stages(id),
  category         VARCHAR(50) NOT NULL,    -- labour | plant | other
  amount           NUMERIC(16,2) NOT NULL,
  notes            TEXT
);

-- ── PRICE LIST (dated) ──────────────────────────
CREATE TABLE material_prices (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  material_id    UUID NOT NULL REFERENCES materials_catalog(id) ON DELETE RESTRICT,
  unit_price     NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
  effective_from DATE NOT NULL,
  entered_by     UUID REFERENCES memberships(id),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
-- current price = latest effective_from <= today for (org, material)
CREATE INDEX idx_prices_lookup ON material_prices(org_id, material_id, effective_from DESC);

-- ── PHASES / BATCHES / BUILDINGS ────────────────
CREATE TABLE phases (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name         VARCHAR(100) NOT NULL,
  sequence     INT,
  target_start DATE,
  target_end   DATE
);

CREATE TABLE batches (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phase_id     UUID REFERENCES phases(id),
  name         VARCHAR(100) NOT NULL,
  sequence     INT,
  status       VARCHAR(20) DEFAULT 'planned',  -- planned | active | done
  started_at   TIMESTAMPTZ,
  trigger_note TEXT                             -- e.g. "start when Batch 1 reaches DPC" (informational)
);

CREATE TABLE buildings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  building_type_id  UUID NOT NULL REFERENCES building_types(id) ON DELETE RESTRICT,
  code              VARCHAR(60) NOT NULL,   -- plot/house number
  phase_id          UUID REFERENCES phases(id),
  batch_id          UUID REFERENCES batches(id),
  current_stage_id  UUID REFERENCES type_stages(id),
  status            VARCHAR(20) DEFAULT 'not_started',
  centroid          GEOGRAPHY(POINT,4326),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (project_id, code)
);
CREATE INDEX idx_buildings_project ON buildings(project_id);
CREATE INDEX idx_buildings_batch   ON buildings(batch_id);

CREATE TABLE building_stage_progress (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id  UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  stage_id     UUID NOT NULL REFERENCES type_stages(id),
  status       stage_status DEFAULT 'not_started',
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  approved_by  UUID REFERENCES memberships(id),
  UNIQUE (building_id, stage_id)
);

-- ── BOQ IMPORT + MAPPING MEMORY ─────────────────
CREATE TABLE boq_imports (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  building_type_id UUID REFERENCES building_types(id),
  source_media_id  UUID REFERENCES media(id),   -- raw xlsx/pdf retained
  format           VARCHAR(10),                 -- xlsx | csv | pdf
  status           import_status DEFAULT 'uploaded',
  imported_by      UUID REFERENCES memberships(id),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE boq_import_rows (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id     UUID NOT NULL REFERENCES boq_imports(id) ON DELETE CASCADE,
  raw_text      TEXT,
  parsed_qty    NUMERIC(14,3),
  parsed_unit   VARCHAR(20),
  parsed_rate   NUMERIC(14,2),
  mapped_material_id UUID REFERENCES materials_catalog(id),
  confidence    NUMERIC(4,3),
  status        VARCHAR(20) DEFAULT 'proposed'  -- proposed | confirmed | rejected
);

CREATE TABLE material_aliases (              -- remember "this text = this material"
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  material_id UUID NOT NULL REFERENCES materials_catalog(id) ON DELETE CASCADE,
  alias_text  VARCHAR(200) NOT NULL,
  UNIQUE (org_id, lower(alias_text))
);

-- ── FEASIBILITY PLANS ───────────────────────────
CREATE TABLE plans (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id  UUID REFERENCES projects(id),
  name        VARCHAR(120) NOT NULL,
  mode        plan_mode NOT NULL,
  available_cash NUMERIC(18,2),             -- for max_delivery mode
  inflows     JSONB,                        -- scheduled future inflows [{date, amount}]
  assumptions JSONB,                        -- price overrides, batch schedule, triggers
  created_by  UUID REFERENCES memberships(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE plan_lines (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id          UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  building_type_id UUID NOT NULL REFERENCES building_types(id),
  quantity         INT NOT NULL,
  target_stage_id  UUID REFERENCES type_stages(id),
  batch_hint       VARCHAR(60)
);
-- Plan RESULTS are computed live (never stored stale) so a price change
-- updates every saved scenario. Optionally cache a JSONB snapshot for comparison.

-- ── LINKS ADDED TO EXISTING TABLES ──────────────
ALTER TABLE material_transactions ADD COLUMN building_id UUID REFERENCES buildings(id);
ALTER TABLE material_transactions ADD COLUMN stage_id    UUID REFERENCES type_stages(id);
ALTER TABLE material_transactions ADD COLUMN batch_id    UUID REFERENCES batches(id);
ALTER TABLE expenses              ADD COLUMN building_id UUID REFERENCES buildings(id);
ALTER TABLE daily_reports         ADD COLUMN building_id UUID REFERENCES buildings(id);
```

*(v2 tables — organizations, app_users, memberships, projects, project_members, materials_catalog, material_transactions, material_balances, expenses, media, daily_reports, daily_report_media, attendance_records, worker_badges, badge_scans, portal_links, portal_access_log, ai_models, ai_inferences, report_embeddings, site_devices, device_events, audit_log — carry forward unchanged except the ALTERs above. budget_lines is retained; a budget line and a building are complementary, not exclusive.)*

### 16.3 Row Level Security
RLS is enabled on **every** table, satisfying AC-6 by construction. Same pattern as v2: SELECT policies gate on `has_project_access()` / `current_org_id()`; **no INSERT/UPDATE/DELETE policies on financial, price, or BOQ-commit tables** — those writes go only through `SECURITY DEFINER` functions (Rule 1). The client portal reads through a separate token-keyed `SECURITY DEFINER` function and never authenticates as a user.

### 16.4 Required server-side functions (additions to v2)

| Function | Enforces |
|---|---|
| `fn_confirm_boq_import(...)` | Writes confirmed rows to `type_boq_items`, stores aliases, one atomic commit |
| `fn_set_material_price(...)` | Inserts a dated price row; never overwrites |
| `fn_create_buildings(type, count, batch)` | Stamps N buildings from a type version, seeds stage progress |
| `fn_advance_batch(batch_id)` | Marks a batch active, logs the human decision, no auto-trigger |
| `fn_complete_stage(building, stage)` | Updates progress, runs requirement-vs-actual check, raises flags |
| `fn_compute_feasibility(plan_id)` | The cash-flow engine: places stages on a timeline, costs them at live prices, returns period-by-period requirement + peak + total |
| `fn_reorder_advice(project)` | Remaining requirement + schedule + stock → order proposals |

### 16.5 Key computed views

```sql
-- Current price of a material (helper used everywhere cost is computed)
CREATE OR REPLACE FUNCTION current_price(p_org UUID, p_material UUID)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT unit_price FROM material_prices
  WHERE org_id = p_org AND material_id = p_material AND effective_from <= CURRENT_DATE
  ORDER BY effective_from DESC LIMIT 1;
$$;

-- Requirement vs actual, per building per material (the loss check)
-- required   = building's type_boq_items for completed stages
-- consumed   = material OUT tagged to that building
-- overrun    = consumed - required
-- (full query joins building_stage_progress → type_boq_items → material_transactions)

-- Project cost at current prices (feeds the board and the planner)
-- Σ over buildings: Σ type_boq_items.quantity * current_price(...)  +  Σ type_stage_costs.amount
```

---

## 17. Build sequence

| Milestone | Contents | Gate |
|---|---|---|
| **M0** | Supabase, schema, RLS, auth, CI, WhatsApp BSP application started | RLS test: org A cannot read any row of org B by any route |
| **M1** | Catalogue, price list, recipe library, BOQ import (Excel then PDF), item-mapping memory | A real Excel BOQ imports and populates a type; aliases remembered |
| **M2** | Buildings, phases, batches, the board, stage progress | 58 buildings stamped from 2 types; board shows each at its stage |
| **M3** | Feasibility planner (funding-required first, then max-delivery), scenarios | "What cash do I need and when" returns a correct cash-flow timeline for a staggered batch plan |
| **M4** | Daily report + media pipeline + offline sync | Report submitted in airplane mode; syncs; no duplicates |
| **M5** | Materials + expenses + approvals + requirement-vs-actual | Overrun on a completed stage flags automatically; balances never negative |
| **M6** | AI-1 (hash), AI-2/7 (OCR), AI-3 (quality), AI-8 (questions), AI-9 (reorder) | Resubmitted old photo flagged; reorder advice matches remaining BOQ |
| **M7** | Client portal + notifications + weekly digest | Client opens portal with PIN; Friday WhatsApp summary delivers |
| **M8** | Pilot on the founder's live project | 21 consecutive days of real reports; someone actively tries to defeat the system |

**M8 is the real gate.** Run on your own buildings first, and instruct someone to try to beat it. What they find is worth more than another month of features.

---

## 18. Acceptance criteria

| ID | Criterion |
|---|---|
| AC-1 | An engineer submits a complete daily report fully offline; it syncs with no duplicates and no loss |
| AC-2 | Every photo has a watermarked display copy and an unmodified original with EXIF intact |
| AC-3 | A resubmitted old photo is flagged as a duplicate automatically |
| AC-4 | Material balances are always accurate and can never go negative |
| AC-5 | An Excel and a PDF BOQ both import into a building type, with unfamiliar items mapped once and remembered |
| AC-6 | Org A cannot read a single row of org B by any route — verified against the API and the database directly |
| AC-7 | Changing one material price re-costs every affected building, batch and saved plan, with old reports unchanged |
| AC-8 | The feasibility planner returns a correct period-by-period cash requirement, peak, and total for a staggered multi-type, multi-batch plan |
| AC-9 | A building's stage overrun (used > required) flags at completion, per stage |
| AC-10 | The board shows 300 buildings, each at its own stage, filterable by phase/batch/type, without lag |
| AC-11 | Expenses above threshold cannot be recorded as spent without approval |
| AC-12 | Every void, approval, price change and batch advance appears in the audit log with actor, time and reason |
| AC-13 | The client opens the portal with link + PIN, no account; link is revocable; every access logged |
| AC-14 | Median daily report completion < 90 s across pilot users |
| AC-15 | No biometric data is collected, stored or processed anywhere |
| AC-16 | PITR enabled and a restore performed and documented |

---

## 19. Open questions for the founder

1. **What is the actual material-fraud loss on your sites?** Everything in Section 10 is sized against an assumption; one real number reorders priorities.
2. **Will suppliers accept delivery confirmation (F-10.9)?** It requires giving the system the supplier's phone number, which some resist because the relationship is the problem.
3. **How firm is your batch trigger in practice?** "Start the next batch at DPC" — is that a hard rule or does cash/weather move it every time? Affects how the planner models the schedule.
4. **Do your recipes carry labour costs you trust, or only materials?** The feasibility peak depends on non-material costs being real, not placeholder.
5. **Camera capex per site** — needed before the P2 hardware offer can be priced.
6. **English or Pidgin as the default engineer language?** Decide from the pilot, not the office.

---

*End of document.*
