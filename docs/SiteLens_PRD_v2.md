# SiteLens — Product Requirements Document

**Version:** 2.0 (supersedes MVP v1.0, July 2026)
**Status:** Build-ready
**Audience:** Engineering (human or AI), design, founder
**Owner:** Lawrence Okpokiri

---

## 0. How to use this document

This PRD is written to be handed directly to a developer with no verbal context. Every requirement has an ID (`F-x`, `NF-x`, `AI-x`, `AC-x`). Where a requirement is deliberately deferred it is marked **[P2]** or **[P3]** and should not be built in the first release.

**Three rules that override anything else in this document if there is ever a conflict:**

1. **No client is trusted with money.** Every write that touches an expense, a material transaction, or a budget goes through a server-side function. Never a direct table insert from the mobile app.
2. **Every fact has a source and a confidence.** Manual entry today, AI inference tomorrow, through the same column. If a new feature requires changing the shape of a record to accommodate AI, the design is wrong.
3. **AI proposes, humans dispose.** No model output ever becomes a financial or attendance record on its own. It becomes a *proposal* that a human accepts, or a *discrepancy* that a human explains.

---

## 1. Executive summary

SiteLens is a mobile-first construction monitoring platform for small developers and contractors in Nigeria.

The problem is not construction knowledge. It is that the person reporting the truth about a site is usually the person who benefits from distorting it. Materials disappear, manpower is inflated, progress is overstated, and the MD finds out three weeks and eight million naira later.

Existing tools fail here for two reasons. International construction software is priced and designed for firms with a QS department. WhatsApp — the actual incumbent — is free, universally adopted, and completely unverifiable.

SiteLens wins by being **less effort than the WhatsApp group on day one, and progressively harder to lie to over time.** The first release earns its place by being faster than typing a message. Every subsequent release adds a verification layer the group chat cannot have.

**The three pillars:**

| Pillar | What it means | How it is verified |
|---|---|---|
| Progress visibility | Office and client see site status same-day | Timestamped, geofenced, duplicate-checked photography |
| Money control | Spend is compared to a *budget line*, not a lump sum | Cost-coded expenses and materials, approval thresholds |
| Proof of work | Reported reality is testable against observed reality | Phase 1: photo forensics. Phase 2+: site cameras |

**The long game:** every daily report generates labelled construction-site imagery tied to a verified material transaction. Twelve months of operation produces a proprietary dataset of Nigerian site conditions that no competitor can buy. That dataset is what makes the camera-based features in Section 9 possible, and it is the real defensibility of this business.

---

## 2. Strategy and sequencing

### 2.1 Why the phasing looks like this

The temptation is to build the camera features first because they are the most impressive. That would be a mistake for three reasons: cameras require capital and power infrastructure the customer does not have on day one; computer-vision models need site-specific training data that does not exist yet; and a product that requires hardware installation cannot be sold self-serve.

So the sequence is: **ship software that works with a phone → accumulate labelled data → deploy models against that data → install cameras only where the customer's pain justifies the capex.**

### 2.2 Release phases

| Phase | Name | Contents | Target |
|---|---|---|---|
| **P1** | Trust the phone | Core reporting, money control, photo forensics, receipt OCR, client portal | MVP launch |
| **P2** | Trust the gate | Gate camera, person counting, vehicle/delivery capture, QR badge attendance | +4–6 months |
| **P3** | Trust the stack | Material counting, progress estimation from imagery, PPE detection | +9–15 months |

### 2.3 Explicitly out of scope for P1

BOQ import from Excel, invoices and payment certificates, equipment maintenance, payroll, accounting sync, advanced procurement workflows, subcontractor portals, drone capture, IoT sensors.

### 2.4 Deliberate cuts from v1.0 of this PRD

- **Selfie-based attendance is removed.** It is biometric processing under the NDPA, it triggers a mandatory DPIA, employee consent to an employer is legally weak, and it does not serve any of the three pillars. Attendance in P1 is a foreman-entered headcount plus optional QR badge scan. See Section 9.4 for how cameras replace this in P2 *without* face recognition.
- **Gantt charts are removed from P1.** A task list with dates and a simple timeline bar is sufficient. Gantt is a v2 selling feature, not an MVP need.
- **Real-time (Socket.io) is removed.** Nothing in P1 requires sub-second updates. Polling and push notifications are adequate and dramatically simpler.

---

## 3. Users

| Persona | Age | Device | What they want | What will make them quit |
|---|---|---|---|---|
| **Admin / MD** | 35–55 | Laptop + phone | To know where the money went before it is gone | Having to learn a complex app |
| **Project Manager** | 30–45 | Phone, lives on WhatsApp | Fast approvals, no surprises | Anything slower than a voice note |
| **Site Engineer** | 25–40 | Low-end Android, poor network | To be left alone | Reporting that takes longer than 90 seconds |
| **Client / Owner** | 40–65 | Phone, non-technical | Reassurance without a site visit | Any login screen |

**The adoption problem, stated honestly:** the Site Engineer receives more work and no benefit. He is the one being monitored. The product must give him something real — the fastest possible way to close out his day, a defence against being blamed for delays he did not cause, and material request handling that saves him phone calls. If the engineer does not want to use it, nothing else in this document matters.

**Design consequence:** the engineer's daily report flow is the single most optimised path in the product. It is measured, and if it exceeds 90 seconds it is a bug.

---

## 4. Roles and permissions

Roles are held at **organisation** level and optionally overridden at **project** level.

| Capability | Admin | PM | Engineer | Client |
|---|---|---|---|---|
| Create/edit projects | ✅ | ❌ | ❌ | ❌ |
| Manage org users | ✅ | ❌ | ❌ | ❌ |
| Manage material catalogue | ✅ | ✅ | ❌ | ❌ |
| Set budget lines | ✅ | ❌ | ❌ | ❌ |
| Create/assign tasks | ✅ | ✅ | ❌ | ❌ |
| Update task progress | ✅ | ✅ | ✅ | ❌ |
| Submit daily report | ✅ | ✅ | ✅ | ❌ |
| Approve daily report | ✅ | ✅ | ❌ | ❌ |
| Log material IN/OUT | ✅ | ✅ | ✅ | ❌ |
| Log expense | ✅ | ✅ | ✅ (below threshold) | ❌ |
| Approve expense | ✅ | ✅ (below threshold) | ❌ | ❌ |
| Void expense/transaction | ✅ | ❌ | ❌ | ❌ |
| View money | ✅ | ✅ | ❌ (own entries only) | Summary only |
| Review AI proposals | ✅ | ✅ | ✅ (site-level only) | ❌ |
| Issue/revoke portal link | ✅ | ✅ | ❌ | ❌ |

**Client access is read-only, always, with no exceptions and no write path of any kind.**

---

## 5. Technical architecture

### 5.1 Stack

| Layer | Choice | Notes |
|---|---|---|
| Database | **Supabase Postgres**, region `eu-west-2` (London) | PostGIS + pgvector + pg_cron enabled |
| Tenancy | **Row Level Security on every table** | Not application-layer filtering |
| Business logic | **Postgres `SECURITY DEFINER` functions + Supabase Edge Functions** | All money and geofence writes |
| Object storage | **Cloudflare R2** | Zero egress — critical, see 5.3 |
| Mobile | **Flutter** (Android 8+ target) | Drift/SQLite local store |
| Web | **Next.js + Tailwind** | Admin console + client portal |
| Auth | **Supabase Auth**, phone OTP via Termii | JWT with `org_id` and `role` claims |
| Maps | Mapbox | |
| Transactional email | **Resend** on `notify.<domain>` | See 5.4 |
| Human email | **Google Workspace** on root domain | See 5.4 |
| Notifications | WhatsApp Business API (primary), SMS (fallback), push, email (tier 3) | |
| Jobs/queue | Postgres table + `pg_cron` | No Redis in P1 |
| ML training/deploy **[P2]** | Roboflow | Annotation → training → edge deployment in one loop |
| Edge inference **[P2]** | NVIDIA Jetson Orin Nano or RPi 5 + Hailo-8L | On-site, see 5.5 |

**Why London:** Supabase has no African region — Cape Town was withdrawn and has not returned. West African submarine cable routing (Equiano, MainOne, 2Africa, WACS) runs north to Europe, so Port Harcourt → London is typically the lowest-latency path available, better than routing to Cape Town. Expect 90–130 ms. Acceptable for an offline-first application.

**Why not the existing Hetzner box:** self-hosted Supabase on a single VPS is right for internal tooling and wrong for a commercial system of record. No automated point-in-time recovery, no HA, no failover, and one bad Docker upgrade away from destroying a paying customer's financial history. Use managed Supabase and **enable PITR** — this is not optional for a product that stores other people's money records.

### 5.2 Multi-tenancy model

Identity and membership are separated so one person can work for more than one organisation — common with PMs and consultants.

```
auth_user (global identity, phone unique globally)
   └── membership (user × org, holds org role)
         └── project_member (membership × project, holds project role override)
```

JWT carries `active_org_id`. RLS policies filter on it. Switching org issues a new token.

### 5.3 Media storage — and why this decision cannot be deferred

Photos are the product's evidence layer *and* its future training data. Two rules:

**Rule 1 — never destroy the original.** v1.0 of this PRD specified compressing every photo to under 500 KB. That would permanently destroy the resolution needed to count blocks or bags later. Photos taken in month one at 500 KB are worthless for model training forever.

Each capture produces three artefacts:

| Derivative | Size | Purpose | Retention |
|---|---|---|---|
| `thumb` | ~50 KB, 400px | List views, portal timeline | Forever |
| `display` | ~400 KB, 1280px | Full-screen viewing, watermarked | Forever |
| `original` | Full sensor res, EXIF intact, unwatermarked | Forensics, model training | 24 months, then cold storage |

Upload priority on the device: `thumb` first, then `display`, then `original` (deferred until Wi-Fi where possible). The report is considered submitted once `thumb` and `display` land.

**Rule 2 — zero egress.** Cloudflare R2 rather than Supabase Storage or S3. Photo bytes are re-read constantly: client portal timelines, admin review, and later, training pipelines pulling tens of thousands of images repeatedly. S3-style egress fees on that access pattern will quietly become the largest line in the cost base. R2 charges nothing for egress.

Buckets are private. Access is via short-lived signed URLs (15 min) issued by an Edge Function that checks the caller's RLS-equivalent permission first. Object keys are opaque UUIDs — never guessable, never containing project names.

### 5.4 Email architecture

Google Workspace is for humans. It must never send application mail.

If SiteLens sends notifications through Workspace, two things happen: you hit the daily recipient cap and start silently dropping mail, and the first spam complaint against a SiteLens notification damages the reputation of the same domain used for investors, banks and government correspondence.

| Domain | Service | Purpose |
|---|---|---|
| `<domain>` | Google Workspace | hello@, support@, billing@ — human correspondence |
| `notify.<domain>` | Resend | All application mail — own DKIM key, own reputation |

DNS: root SPF includes Google only. Subdomain has independent SPF/DKIM. DMARC on root at `p=quarantine` minimum with an explicit `sp=` policy governing subdomains. `Reply-To` on all app mail points to `support@<domain>` so replies reach a human inbox.

**Email is tier three in this market.** The engineer will never read it. Email carries the client portal link, receipts, monthly statements and security events. WhatsApp and SMS carry everything operational.

### 5.5 Edge architecture for cameras **[P2]**

Nigerian sites have unreliable power and expensive, slow uplinks. Streaming video to the cloud is not viable.

```
IP camera (PoE) → Edge gateway on site → 4G uplink → Cloud
                   ├ runs detection locally
                   ├ uploads events + still frames only, never video
                   └ buffers 72h if uplink drops
```

The edge gateway uploads **structured events and thumbnails**, typically under 5 MB per day per camera. Raw video never leaves the site unless explicitly requested for an investigation.

Site power: cameras and gateway must run on a dedicated solar + battery unit sized for 48 hours of autonomy. Grid power on an active Nigerian site cannot be relied on, and generator downtime correlates precisely with the periods when theft occurs. Physical security of the equipment is a real risk and must be priced into the P2 hardware offer.

---

## 6. Functional requirements — P1

### F-1 Organisation and user management
- F-1.1 Signup creates an organisation and an Admin membership in one step. Phone + OTP only; no password in P1.
- F-1.2 Admin invites users by phone number with an org role. Invite delivered by WhatsApp with SMS fallback.
- F-1.3 A user may belong to multiple organisations and switches between them in-app.
- F-1.4 Deactivating a user revokes access but never deletes their historical records.

### F-2 Project setup
- F-2.1 Fields: name, description, location (map picker), start date, target end date, total budget, currency (NGN default).
- F-2.2 Geofence: centre point from map picker, radius configurable **50–500 m, default 150 m**. (100 m is too tight for typical estate developments.)
- F-2.3 Duplicate active project names within an organisation are rejected.
- F-2.4 Projects are archived, never deleted.

### F-3 Budget lines — *the money-control core*
> This did not exist in v1.0 and is the single most important addition. Without it, "Budget vs Actual" is one number against one number, which tells the MD he has overspent only after he has overspent.

- F-3.1 Admin defines budget lines per project: cost code, name, budgeted amount. A default template (Substructure, Frame, Blockwork, Roofing, M&E, Finishes, Labour, Preliminaries, Contingency) is offered on project creation and is fully editable.
- F-3.2 Every expense and every material IN transaction **must** be assigned to a budget line.
- F-3.3 Live computation per line: budgeted, committed, spent, remaining, % consumed.
- F-3.4 **Burn-rate alert:** when a line's % consumed exceeds the % progress of tasks mapped to that line by more than 15 points, raise a variance alert to PM and Admin. *This is the alert that saves money — it fires while there is still budget left.*
- F-3.5 Reallocation between lines is an Admin-only action and is written to the audit log with a reason.

### F-4 Tasks
- F-4.1 Two levels only: task and sub-task. No arbitrary nesting in P1.
- F-4.2 Fields: title, description, assignee, budget line (optional), start date, due date, weight (default 1).
- F-4.3 Status: `not_started` → `in_progress` → `done`, plus `blocked` reachable from any state with a mandatory reason.
- F-4.4 Progress is a manual percentage in P1.
- F-4.5 **Project progress is a weighted average over leaf tasks only.** Parent tasks are excluded and derive their value from children. (v1.0's `AVG(progress_percent)` double-counted parents and returned a wrong number.)

### F-5 Daily report
- F-5.1 One report per project per day. A second submission for the same date opens the existing report for amendment; amendments are versioned, never overwritten.
- F-5.2 Fields: date (defaults today, backdating limited to 3 days and flagged), work summary, manpower count by trade, weather (auto-filled when online, manually selectable offline), issues/blockers, tasks worked on with progress updates.
- F-5.3 **Minimum 3 photos, maximum 20.** Each captured in-app — gallery import is disabled to prevent submission of old or borrowed images.
- F-5.4 Each photo is stamped at capture with GPS, device time, project name and a server-verified sequence number. The stamp is burned into the `display` derivative; the `original` is retained unmodified with EXIF intact.
- F-5.5 Geofence check at capture. Outside the fence, capture is permitted but the photo is **flagged**, not blocked — blocking creates a workaround culture, and a flagged photo is more useful evidence than no photo. Reports containing flagged photos require PM approval.
- F-5.6 Fully functional offline. See Section 8.
- F-5.7 PM or Admin approves, rejects with reason, or requests amendment.

### F-6 Materials
- F-6.1 Admin maintains an org-level catalogue: name, unit, reorder level, standard rate.
- F-6.2 **IN** transaction: material, quantity, unit price, supplier, budget line, waybill/receipt photo (mandatory), delivery note number.
- F-6.3 **OUT** transaction: material, quantity, task, purpose note.
- F-6.4 Running balance per project per material, maintained by a database function under row lock. Not recomputed by aggregation on every read.
- F-6.5 An OUT that would drive balance negative is rejected with a clear message. Negative stock is always a data error or a theft signal, never a valid state.
- F-6.6 Balance below reorder level alerts PM and Admin.
- F-6.7 Transfers between projects within an org are supported as a paired OUT/IN.
- F-6.8 Transactions are immutable. Corrections are made by voiding with a reason, which reverses the balance effect and is logged.

### F-7 Expenses
- F-7.1 Fields: budget line (mandatory), category, amount, description, paid to, payment method, receipt photo.
- F-7.2 **Approval thresholds, configurable per org.** Default: Engineer may log up to ₦50,000, requiring PM approval. Above ₦250,000 requires Admin approval. Unapproved expenses appear in a pending queue and count as *committed*, not *spent*.
- F-7.3 Immutable. Void with mandatory reason; Admin only; fully audited.
- F-7.4 Receipt OCR pre-fills amount, date and payee (see AI-2).

### F-8 Attendance
- F-8.1 **No selfies. No face recognition.** See Section 11.
- F-8.2 Foreman or engineer records daily headcount by trade at start of shift, within the geofence.
- F-8.3 Optional QR badge scan for named workers where the customer wants individual records. Badge is a printed card, not biometric.
- F-8.4 Headcount is automatically reconciled against the manpower figure in the daily report. Divergence over 20% raises a flag. *There must be exactly one source of truth for labour — the attendance record — and the daily report reads from it rather than asking for the number twice.*
- F-8.5 Every attendance record carries `source` (`manual` | `qr` | `camera` | `import`) and optional `confidence`, so camera counting in P2 slots in with no schema change.

### F-9 Client portal
- F-9.1 Unique tokenised URL per **recipient**, not per project, so access can be revoked individually.
- F-9.2 Access requires the link plus a 6-digit PIN set by the issuer and shared separately. A forwarded WhatsApp link alone must not expose project financials.
- F-9.3 Expires in 90 days, renewable. Revocable instantly.
- F-9.4 Shows: overall progress, photo timeline, milestone status, spend against budget at summary level (not line-item detail unless enabled per link), overdue items.
- F-9.5 Every access is logged with timestamp and IP. Admin can see when the client last opened it.
- F-9.6 Never exposes supplier names, unit prices or individual worker data.

### F-10 Notifications

| Trigger | Recipient | Channel | Timing |
|---|---|---|---|
| Daily report not submitted | Engineer | WhatsApp → SMS | 17:00 local |
| Report still missing | PM | WhatsApp | 19:00 local |
| Material below reorder level | PM, Admin | WhatsApp | Immediate |
| Expense above threshold | Approver | WhatsApp + push | Immediate |
| Budget line variance (F-3.4) | PM, Admin | WhatsApp | Daily digest 08:00 |
| Task overdue | Assignee, PM | Push | 08:00 |
| Photo flagged outside geofence | PM | Push | Immediate |
| AI discrepancy raised | PM | Push | Immediate |
| Weekly client summary | Client | WhatsApp + email | Friday 16:00 |

All timings are org-configurable. All notification types are individually mutable per user. WhatsApp requires Meta business verification, a BSP relationship and pre-approved templates — **start this process in week one of the build, it takes weeks and blocks launch.**

---

## 7. Anti-fraud design

The uncomfortable truth about v1.0: the people entering the data were the people being policed. GPS photos prove someone was on site; they do not prove the block count. If the engineer, storekeeper and supplier collude — the normal pattern — the system records the fraud faithfully and gives it a credible audit trail.

P1 cannot eliminate this. It can raise the cost of it, and it can catch the lazy majority of it:

| Vector | Countermeasure | Phase |
|---|---|---|
| Reusing yesterday's photos | **Perceptual hashing** of every photo; near-duplicates against the last 90 days of the same project are flagged automatically | P1 |
| GPS spoofing (mock location apps) | Detect mock-location provider flag on Android; cross-check reported GPS against network/cell location; flag divergence | P1 |
| Backdating reports | Server timestamp is authoritative; device-vs-server clock skew over 10 minutes flagged | P1 |
| Inflated manpower | Reconcile attendance against daily report (F-8.4) | P1 |
| Inflated material usage | Consumption ratio per unit of work against configurable norms — e.g. cement bags per m³ of concrete | P1 |
| Fake deliveries | **Supplier-side confirmation**: supplier receives an SMS link to confirm the delivery they were paid for. An unconfirmed delivery is a live flag | P1 |
| Ghost workers | Camera headcount at gate vs recorded attendance | P2 |
| Understated deliveries | Camera counting at offload vs logged quantity | P3 |

**Supplier confirmation (F-6.9) is the highest-leverage anti-fraud feature in P1 and costs almost nothing to build.** It introduces an independent party who has no incentive to under-report what they delivered and were paid for. Build it.

---

## 8. Offline-first architecture

This is the hardest engineering problem in the product and v1.0 gave it one line. It gets a section.

### 8.1 Model
Local SQLite (Drift) is the source of truth for the mobile client. The app never blocks on the network. An **outbox** table holds pending mutations; a sync worker drains it when connectivity returns.

### 8.2 Identity and idempotency
- **All IDs are client-generated UUIDv7** — time-ordered, generated on device, used as the primary key server-side. No server round-trip needed to create a record.
- Every mutation additionally carries an `idempotency_key`. The server enforces uniqueness on it. **Without this, a retry over flaky 3G silently creates duplicate expenses.** This is the single most common way offline apps corrupt financial data.

### 8.3 Conflict resolution
Last-write-wins is **not acceptable** for financial records and must not be used.

| Record type | Strategy |
|---|---|
| Financial (expenses, material transactions) | **Append-only.** No conflict possible — records are never edited, only voided. |
| Daily reports | Versioned. Concurrent edits create a new version; PM sees both and resolves. |
| Task progress | Last-write-wins is acceptable, with the losing value retained in the audit log. |
| Attendance | Unique on (project, date, source). Second submission amends and is versioned. |

### 8.4 Media sync
Photos queue separately from data with their own retry and backoff. A report syncs and becomes visible once its `thumb` derivatives have uploaded; `original` files continue uploading in the background, preferentially on Wi-Fi. Local originals are retained until upload is confirmed, then purged on a 7-day lag.

### 8.5 Sync integrity
Every sync response returns a server cursor. The client stores it and resumes from it. On any integrity failure the client requests a full re-baseline of that project rather than attempting a partial repair.

---

## 9. AI architecture and roadmap

### 9.1 The principle that makes this work

Every observable fact in SiteLens — a headcount, a material quantity, a progress percentage — is stored with:

```
value          the fact
source         manual | qr | ocr | camera | model
confidence     null for human entry, 0.0–1.0 for inference
model_id       null for human entry
verified_by    user who accepted or corrected it
```

An AI feature is therefore never a new subsystem. It is a new **source** writing into an existing column. This is why cameras can be added in P2 without a data migration.

### 9.2 The inference loop

```
capture → inference → proposal → human verdict → verified record
                                       │
                                       └→ training label
```

Every human verdict on an AI proposal is a labelled example. The product generates its own training data as a by-product of normal use. This is the flywheel — and it only works if the loop is built into the schema from day one, which is why the `ai_inferences` table exists in P1 even though there is barely anything writing to it yet.

### 9.3 P1 AI features — no cameras required

| ID | Feature | Approach | Value |
|---|---|---|---|
| **AI-1** | Duplicate photo detection | Perceptual hash (pHash/dHash), Hamming distance against 90-day project window. No ML model needed. | Catches the most common fake-report trick for near-zero cost. Build this first. |
| **AI-2** | Receipt & waybill OCR | Vision LLM API (Claude or Gemini) → structured JSON: amount, date, payee, line items, quantities | Cuts expense entry to one photo. Also cross-checks the typed quantity against the waybill — a live fraud check. |
| **AI-3** | Photo quality gate | Lightweight on-device classifier: blur, darkness, obstruction, indoor-vs-site | Rejects useless evidence at capture rather than at review. Protects training-data quality. |
| **AI-4** | Report summarisation & digest | LLM over the week's reports → MD's Monday briefing | The Admin persona will not read 30 reports. They will read one paragraph. |
| **AI-5** | Spend anomaly detection | Statistical: expense outliers by category, supplier price drift, unusual timing | Flags the ₦400k "miscellaneous" before it repeats |
| **AI-6** | Consumption-ratio checking | Rules + learned norms: material used vs quantity of work completed | The core material-loss check, achievable with no vision model at all |
| **AI-7** | Natural-language project query | RAG over reports, expenses, transactions using pgvector | "How much have we spent on blockwork at Estate B?" answered in chat |

**AI-1, AI-2 and AI-6 deliver most of the fraud-detection value and none of them require a camera or a custom model.** Build these in P1.

### 9.4 P2 — gate camera

**AI-8 — Person counting (NOT face recognition).**

The fraud being targeted is inflated headcount — ghost workers on the payroll. Catching that requires a **count**, not identities. A person-detection model (YOLO-class) counts individuals crossing a gate line and reports a number. No faces are stored, no identities are matched, no biometric template is ever created.

This is a deliberate design choice with three benefits: it avoids the entire NDPA sensitive-data regime, it is materially cheaper and more accurate than face recognition in dust and hard-hat conditions, and it is defensible to the workforce, whose cooperation you need.

Where the customer wants named attendance, the QR badge from F-8.3 supplies identity and the camera supplies the count. The two are reconciled. Divergence is the signal.

**AI-9 — Vehicle and delivery capture.** ANPR on the gate camera timestamps every vehicle entry. A material IN transaction with no corresponding vehicle arrival within a time window is a strong theft signal. Cheap, high-signal, no material counting required.

### 9.5 P3 — material counting

**AI-10 — Delivery counting.** Object detection counting units (blocks, bags, rods) as they are offloaded.

**Honest assessment of difficulty:** counting a *stack* is unreliable because of occlusion — a stack of 500 bags shows perhaps 50 visible faces, and interior estimation from a single view is guesswork. Counting the *offload stream* is far more tractable: units pass the camera one or few at a time against a stable background.

Therefore **AI-10 targets the delivery event, not the store.** Realistic accuracy at maturity: 90–96% on well-framed offloads, degrading sharply in rain, dusk and disorderly offloading. It must be presented as a discrepancy flag ("camera counted 480, waybill says 500 — review") and never as an authoritative quantity.

Requires roughly 5,000–10,000 labelled Nigerian-site images per material type. **This is exactly what P1 and P2 accumulate.** Train through Roboflow, deploy to the edge gateway.

**AI-11 — Progress estimation.** Multi-view imagery → structural progress estimate to replace manual percentages. Research-grade; do not commit to it commercially until proven.

**AI-12 — PPE compliance.** Helmet/vest detection. Straightforward technically, and often the feature that actually sells the camera package, because it maps to insurance and client HSE requirements.

### 9.6 Cost discipline

Inference cost must stay under **5% of ARPU**. At ₦30,000/project/month that is ₦1,500.

Consequences for the design:
- Do **not** run a vision model on every photo. Run AI-1 (hash) on all photos — it costs nothing. Run AI-2 only on receipts and waybills. Run AI-3 on-device.
- Batch AI-4 and AI-5 into scheduled nightly jobs rather than per-event calls.
- Cache aggressively; never re-infer an unchanged image.
- Store `cost_estimate` on every `ai_inferences` row so unit economics are measurable from day one rather than discovered in a bill.

---

## 10. Data model

### 10.1 Corrections applied from v1.0

| Issue in v1.0 | Fix |
|---|---|
| `users.phone` globally unique broke multi-org membership | Split identity from membership |
| No idempotency keys — offline retries duplicate financial records | `idempotency_key` unique on all mutation tables |
| RLS absent despite tenancy being an acceptance criterion | RLS on every table |
| PRD promised void-with-reason; schema had no void columns | `voided_at`, `void_reason`, `voided_by` |
| "Audit-friendly" title, no audit table | `audit_log` |
| `ON DELETE CASCADE` on financial records | `RESTRICT` |
| PostGIS in stack, plain decimals in schema | `geography(Point,4326)` + GiST index |
| No uniqueness on attendance or daily reports | Unique constraints added |
| Two sources of truth for manpower | Attendance is authoritative |
| Budget was a single lump number | `budget_lines` |
| Client portal links had no table | `portal_links` |
| Photos modelled inline on reports only | Unified `media` table |
| No AI-readiness at all | `source`/`confidence` columns, `ai_models`, `ai_inferences`, `site_devices`, `device_events` |

### 10.2 Schema

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_cron";

-- ─────────────── ENUMS ───────────────
CREATE TYPE org_role        AS ENUM ('admin','pm','engineer','client');
CREATE TYPE fact_source     AS ENUM ('manual','qr','ocr','camera','model','import');
CREATE TYPE txn_type        AS ENUM ('IN','OUT');
CREATE TYPE approval_status AS ENUM ('pending','approved','rejected','voided');
CREATE TYPE task_status     AS ENUM ('not_started','in_progress','done','blocked');
CREATE TYPE inference_status AS ENUM ('proposed','accepted','rejected','superseded');

-- ─────────────── TENANCY ───────────────
CREATE TABLE organizations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(150) NOT NULL,
  country_code CHAR(2) DEFAULT 'NG',
  currency     CHAR(3) DEFAULT 'NGN',
  settings     JSONB DEFAULT '{}',        -- thresholds, notification timings
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  archived_at  TIMESTAMPTZ
);

-- Global identity. One human, one row, regardless of how many orgs.
CREATE TABLE app_users (
  id         UUID PRIMARY KEY,            -- mirrors auth.users.id
  full_name  VARCHAR(100) NOT NULL,
  phone      VARCHAR(20) UNIQUE NOT NULL,
  email      VARCHAR(100),
  locale     VARCHAR(10) DEFAULT 'en-NG',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE memberships (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  user_id       UUID NOT NULL REFERENCES app_users(id)     ON DELETE RESTRICT,
  role          org_role NOT NULL,
  is_active     BOOLEAN DEFAULT TRUE,
  deactivated_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (org_id, user_id)
);

-- ─────────────── PROJECTS ───────────────
CREATE TABLE projects (
  id                UUID PRIMARY KEY,
  org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name              VARCHAR(150) NOT NULL,
  description       TEXT,
  location_text     VARCHAR(255),
  centroid          GEOGRAPHY(POINT,4326),
  geofence_radius_m INT DEFAULT 150 CHECK (geofence_radius_m BETWEEN 50 AND 500),
  start_date        DATE,
  target_end_date   DATE,
  total_budget      NUMERIC(16,2),
  status            VARCHAR(20) DEFAULT 'active',
  created_by        UUID REFERENCES app_users(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  archived_at       TIMESTAMPTZ
);
CREATE UNIQUE INDEX uq_active_project_name
  ON projects(org_id, lower(name)) WHERE archived_at IS NULL;
CREATE INDEX idx_projects_geo ON projects USING GIST (centroid);

CREATE TABLE project_members (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  membership_id  UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  role_override  org_role,
  UNIQUE (project_id, membership_id)
);
CREATE INDEX idx_pm_membership ON project_members(membership_id);

-- ─────────────── BUDGET ───────────────
CREATE TABLE budget_lines (
  id              UUID PRIMARY KEY,
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  cost_code       VARCHAR(20) NOT NULL,
  name            VARCHAR(150) NOT NULL,
  budgeted_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
  sort_order      INT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (project_id, cost_code)
);

-- ─────────────── TASKS ───────────────
CREATE TABLE tasks (
  id               UUID PRIMARY KEY,
  project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_task_id   UUID REFERENCES tasks(id) ON DELETE CASCADE,
  budget_line_id   UUID REFERENCES budget_lines(id),
  title            VARCHAR(200) NOT NULL,
  description      TEXT,
  assigned_to      UUID REFERENCES memberships(id),
  status           task_status DEFAULT 'not_started',
  blocked_reason   TEXT,
  progress_percent INT DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  weight           NUMERIC(6,2) DEFAULT 1,
  start_date       DATE,
  due_date         DATE,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  CHECK (status <> 'blocked' OR blocked_reason IS NOT NULL)
);
CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_parent  ON tasks(parent_task_id);

-- ─────────────── MEDIA (unified) ───────────────
CREATE TABLE media (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id      UUID REFERENCES projects(id) ON DELETE RESTRICT,
  key_thumb       TEXT,
  key_display     TEXT,
  key_original    TEXT,
  mime_type       VARCHAR(50),
  bytes_original  BIGINT,
  captured_at     TIMESTAMPTZ,           -- device clock
  received_at     TIMESTAMPTZ DEFAULT NOW(),  -- server clock, authoritative
  captured_point  GEOGRAPHY(POINT,4326),
  gps_accuracy_m  NUMERIC(6,2),
  within_geofence BOOLEAN,
  mock_location   BOOLEAN DEFAULT FALSE, -- Android mock-provider flag
  clock_skew_s    INT,
  phash           BIT(64),               -- AI-1 duplicate detection
  duplicate_of    UUID REFERENCES media(id),
  quality_score   NUMERIC(3,2),          -- AI-3
  exif            JSONB,
  uploaded_by     UUID REFERENCES memberships(id),
  UNIQUE (id)
);
CREATE INDEX idx_media_project   ON media(project_id, received_at DESC);
CREATE INDEX idx_media_phash     ON media(phash);
CREATE INDEX idx_media_flags     ON media(project_id)
  WHERE within_geofence = FALSE OR mock_location = TRUE OR duplicate_of IS NOT NULL;

-- ─────────────── DAILY REPORTS ───────────────
CREATE TABLE daily_reports (
  id                UUID PRIMARY KEY,
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  report_date       DATE NOT NULL,
  version           INT DEFAULT 1,
  submitted_by      UUID REFERENCES memberships(id),
  work_summary      TEXT NOT NULL,
  weather           VARCHAR(50),
  issues            TEXT,
  status            approval_status DEFAULT 'pending',
  approved_by       UUID REFERENCES memberships(id),
  approved_at       TIMESTAMPTZ,
  rejection_reason  TEXT,
  is_offline_submission BOOLEAN DEFAULT FALSE,
  submitted_point   GEOGRAPHY(POINT,4326),
  device_captured_at TIMESTAMPTZ,
  submitted_at      TIMESTAMPTZ DEFAULT NOW(),
  idempotency_key   TEXT UNIQUE NOT NULL,
  UNIQUE (project_id, report_date, version)
);
CREATE INDEX idx_reports_project_date ON daily_reports(project_id, report_date DESC);

CREATE TABLE daily_report_media (
  report_id UUID REFERENCES daily_reports(id) ON DELETE CASCADE,
  media_id  UUID REFERENCES media(id) ON DELETE RESTRICT,
  caption   VARCHAR(255),
  PRIMARY KEY (report_id, media_id)
);

CREATE TABLE daily_report_tasks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id         UUID REFERENCES daily_reports(id) ON DELETE CASCADE,
  task_id           UUID REFERENCES tasks(id) ON DELETE RESTRICT,
  progress_before   INT NOT NULL,   -- explicit: absolute values, not deltas
  progress_after    INT NOT NULL,
  note              TEXT,
  UNIQUE (report_id, task_id)
);

-- ─────────────── MATERIALS ───────────────
CREATE TABLE materials_catalog (
  id             UUID PRIMARY KEY,
  org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name           VARCHAR(100) NOT NULL,
  unit           VARCHAR(20) NOT NULL,
  reorder_level  NUMERIC(12,2) DEFAULT 10,
  standard_rate  NUMERIC(12,2),
  archived_at    TIMESTAMPTZ,
  UNIQUE (org_id, lower(name))
);

CREATE TABLE material_transactions (
  id                UUID PRIMARY KEY,
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  material_id       UUID NOT NULL REFERENCES materials_catalog(id) ON DELETE RESTRICT,
  budget_line_id    UUID REFERENCES budget_lines(id),
  type              txn_type NOT NULL,
  quantity          NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
  unit_price        NUMERIC(12,2),
  supplier_name     VARCHAR(150),
  supplier_phone    VARCHAR(20),
  delivery_note_no  VARCHAR(60),
  task_id           UUID REFERENCES tasks(id),
  receipt_media_id  UUID REFERENCES media(id),
  transfer_pair_id  UUID REFERENCES material_transactions(id),
  source            fact_source DEFAULT 'manual',
  confidence        NUMERIC(4,3),
  supplier_confirmed_at TIMESTAMPTZ,     -- F-6.9 independent verification
  voided_at         TIMESTAMPTZ,
  voided_by         UUID REFERENCES memberships(id),
  void_reason       TEXT,
  created_by        UUID REFERENCES memberships(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  idempotency_key   TEXT UNIQUE NOT NULL,
  CHECK (voided_at IS NULL OR void_reason IS NOT NULL)
);
CREATE INDEX idx_mt_project ON material_transactions(project_id, created_at DESC);
CREATE INDEX idx_mt_balance ON material_transactions(project_id, material_id)
  WHERE voided_at IS NULL;

-- Maintained by trigger under row lock; never recomputed on read.
CREATE TABLE material_balances (
  project_id   UUID REFERENCES projects(id) ON DELETE RESTRICT,
  material_id  UUID REFERENCES materials_catalog(id) ON DELETE RESTRICT,
  balance      NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (project_id, material_id)
);

-- ─────────────── EXPENSES ───────────────
CREATE TABLE expenses (
  id               UUID PRIMARY KEY,
  project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  budget_line_id   UUID NOT NULL REFERENCES budget_lines(id),
  category         VARCHAR(50),
  amount           NUMERIC(16,2) NOT NULL CHECK (amount > 0),
  description      TEXT,
  paid_to          VARCHAR(150),
  payment_method   VARCHAR(20),
  receipt_media_id UUID REFERENCES media(id),
  status           approval_status DEFAULT 'pending',
  approved_by      UUID REFERENCES memberships(id),
  approved_at      TIMESTAMPTZ,
  ocr_payload      JSONB,                 -- AI-2 raw extraction
  source           fact_source DEFAULT 'manual',
  voided_at        TIMESTAMPTZ,
  voided_by        UUID REFERENCES memberships(id),
  void_reason      TEXT,
  created_by       UUID REFERENCES memberships(id),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  idempotency_key  TEXT UNIQUE NOT NULL,
  CHECK (voided_at IS NULL OR void_reason IS NOT NULL)
);
CREATE INDEX idx_expenses_project ON expenses(project_id, created_at DESC);
CREATE INDEX idx_expenses_line    ON expenses(budget_line_id) WHERE voided_at IS NULL;

-- ─────────────── ATTENDANCE ───────────────
CREATE TABLE attendance_records (
  id              UUID PRIMARY KEY,
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  work_date       DATE NOT NULL,
  trade           VARCHAR(50),
  headcount       INT NOT NULL CHECK (headcount >= 0),
  source          fact_source NOT NULL DEFAULT 'manual',
  confidence      NUMERIC(4,3),
  device_id       UUID,                   -- set when source = 'camera'
  recorded_by     UUID REFERENCES memberships(id),
  recorded_point  GEOGRAPHY(POINT,4326),
  within_geofence BOOLEAN,
  version         INT DEFAULT 1,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  idempotency_key TEXT UNIQUE NOT NULL,
  UNIQUE (project_id, work_date, trade, source, version)
);
CREATE INDEX idx_att_project_date ON attendance_records(project_id, work_date DESC);

-- Optional named attendance via QR badge (F-8.3). No biometrics.
CREATE TABLE worker_badges (
  id          UUID PRIMARY KEY,
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  badge_code  VARCHAR(40) UNIQUE NOT NULL,
  worker_name VARCHAR(100) NOT NULL,
  trade       VARCHAR(50),
  is_active   BOOLEAN DEFAULT TRUE
);

CREATE TABLE badge_scans (
  id          UUID PRIMARY KEY,
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  badge_id    UUID NOT NULL REFERENCES worker_badges(id) ON DELETE RESTRICT,
  work_date   DATE NOT NULL,
  scanned_at  TIMESTAMPTZ NOT NULL,
  direction   VARCHAR(5) CHECK (direction IN ('in','out')),
  scanned_by  UUID REFERENCES memberships(id),
  idempotency_key TEXT UNIQUE NOT NULL,
  UNIQUE (badge_id, work_date, direction)
);

-- ─────────────── CLIENT PORTAL ───────────────
CREATE TABLE portal_links (
  id             UUID PRIMARY KEY,
  project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  recipient_name VARCHAR(100),
  recipient_phone VARCHAR(20),
  token_hash     TEXT NOT NULL UNIQUE,     -- store hash, never the token
  pin_hash       TEXT NOT NULL,
  show_line_items BOOLEAN DEFAULT FALSE,
  expires_at     TIMESTAMPTZ NOT NULL,
  revoked_at     TIMESTAMPTZ,
  created_by     UUID REFERENCES memberships(id),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE portal_access_log (
  id           BIGSERIAL PRIMARY KEY,
  link_id      UUID REFERENCES portal_links(id) ON DELETE CASCADE,
  accessed_at  TIMESTAMPTZ DEFAULT NOW(),
  ip_address   INET,
  user_agent   TEXT,
  pin_success  BOOLEAN
);

-- ─────────────── AI ───────────────
CREATE TABLE ai_models (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL,
  version     VARCHAR(30)  NOT NULL,
  task        VARCHAR(50)  NOT NULL,   -- ocr | person_count | material_count | ppe | anomaly
  runtime     VARCHAR(30),             -- api | edge | on_device
  deployed_at TIMESTAMPTZ DEFAULT NOW(),
  retired_at  TIMESTAMPTZ,
  UNIQUE (name, version)
);

CREATE TABLE ai_inferences (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id     UUID REFERENCES projects(id) ON DELETE RESTRICT,
  model_id       UUID REFERENCES ai_models(id),
  subject_type   VARCHAR(40) NOT NULL,  -- expense | material_transaction | attendance | media
  subject_id     UUID,
  media_id       UUID REFERENCES media(id),
  output         JSONB NOT NULL,
  confidence     NUMERIC(4,3),
  status         inference_status DEFAULT 'proposed',
  human_value    JSONB,                 -- the corrected/accepted truth → training label
  reviewed_by    UUID REFERENCES memberships(id),
  reviewed_at    TIMESTAMPTZ,
  cost_estimate  NUMERIC(10,6),         -- unit economics, section 9.6
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_inf_pending ON ai_inferences(project_id, status)
  WHERE status = 'proposed';
CREATE INDEX idx_inf_training ON ai_inferences(model_id, status)
  WHERE human_value IS NOT NULL;

-- Semantic search over reports (AI-7)
CREATE TABLE report_embeddings (
  report_id  UUID PRIMARY KEY REFERENCES daily_reports(id) ON DELETE CASCADE,
  embedding  VECTOR(1536),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────── SITE DEVICES [P2] ───────────────
CREATE TABLE site_devices (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  device_type    VARCHAR(30) NOT NULL,   -- camera | edge_gateway
  label          VARCHAR(100),
  serial_number  VARCHAR(80) UNIQUE,
  installed_at   TIMESTAMPTZ,
  last_heartbeat TIMESTAMPTZ,
  status         VARCHAR(20) DEFAULT 'active',
  config         JSONB DEFAULT '{}'
);

CREATE TABLE device_events (
  id           BIGSERIAL PRIMARY KEY,
  device_id    UUID NOT NULL REFERENCES site_devices(id) ON DELETE CASCADE,
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  event_type   VARCHAR(40) NOT NULL,     -- person_cross | vehicle_entry | count_result
  occurred_at  TIMESTAMPTZ NOT NULL,
  payload      JSONB NOT NULL,
  media_id     UUID REFERENCES media(id),
  ingested_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_dev_events ON device_events(project_id, occurred_at DESC);

-- ─────────────── AUDIT ───────────────
CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  org_id      UUID NOT NULL,
  actor_id    UUID,
  action      VARCHAR(60) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id   UUID,
  before      JSONB,
  after       JSONB,
  reason      TEXT,
  ip_address  INET,
  occurred_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_org    ON audit_log(org_id, occurred_at DESC);
```

### 10.3 Row Level Security

RLS is enabled on **every** table. This satisfies acceptance criterion AC-6 by construction rather than by developer discipline.

```sql
-- Helper: current user's org from JWT
CREATE OR REPLACE FUNCTION current_org_id() RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'active_org_id','')::uuid;
$$;

CREATE OR REPLACE FUNCTION current_membership_id() RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT m.id FROM memberships m
  WHERE m.user_id = auth.uid() AND m.org_id = current_org_id() AND m.is_active;
$$;

CREATE OR REPLACE FUNCTION has_project_access(p_project UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects p
    JOIN memberships m ON m.org_id = p.org_id
    WHERE p.id = p_project
      AND m.user_id = auth.uid()
      AND m.is_active
      AND m.org_id = current_org_id()
      AND (m.role IN ('admin','pm') OR EXISTS (
            SELECT 1 FROM project_members pm
            WHERE pm.project_id = p.id AND pm.membership_id = m.id))
  );
$$;

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY projects_select ON projects FOR SELECT
  USING (org_id = current_org_id() AND has_project_access(id));

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY expenses_select ON expenses FOR SELECT
  USING (has_project_access(project_id));
-- No INSERT/UPDATE/DELETE policies on expenses at all.
-- All writes go through SECURITY DEFINER functions. Rule 1.
```

**Apply the same pattern to every table.** The client portal reads through a separate `SECURITY DEFINER` function keyed on the portal token — the portal never authenticates as a user and never touches these policies.

### 10.4 Required server-side functions

| Function | Enforces |
|---|---|
| `fn_submit_daily_report(...)` | Idempotency, geofence evaluation, versioning, phash duplicate check |
| `fn_log_material_txn(...)` | Row lock on balance, negative-stock rejection, budget line validity |
| `fn_void_material_txn(...)` | Admin only, reason required, balance reversal, audit write |
| `fn_create_expense(...)` | Threshold routing to correct approver, budget line required |
| `fn_approve_expense(...)` | Approver authority check against amount threshold |
| `fn_record_attendance(...)` | Source precedence, versioning, geofence |
| `fn_issue_portal_link(...)` | Token generation, hashing, PIN hashing |
| `fn_accept_inference(...)` | Writes human verdict, promotes proposal to record, creates training label |

### 10.5 Corrected dashboard queries

```sql
-- Project progress: weighted, LEAF TASKS ONLY.
-- v1.0's AVG(progress_percent) double-counted parents and was simply wrong.
SELECT COALESCE(
  SUM(t.progress_percent * t.weight)::numeric / NULLIF(SUM(t.weight),0), 0
) AS progress_pct
FROM tasks t
WHERE t.project_id = $1
  AND NOT EXISTS (SELECT 1 FROM tasks c WHERE c.parent_task_id = t.id);

-- Budget vs actual, by line. This is the money-control view.
SELECT
  bl.cost_code, bl.name, bl.budgeted_amount,
  COALESCE(e.spent,0) + COALESCE(m.spent,0)              AS spent,
  bl.budgeted_amount - COALESCE(e.spent,0) - COALESCE(m.spent,0) AS remaining,
  ROUND(100 * (COALESCE(e.spent,0)+COALESCE(m.spent,0))
        / NULLIF(bl.budgeted_amount,0), 1)               AS pct_consumed
FROM budget_lines bl
LEFT JOIN (
  SELECT budget_line_id, SUM(amount) spent FROM expenses
  WHERE voided_at IS NULL AND status = 'approved' GROUP BY 1
) e ON e.budget_line_id = bl.id
LEFT JOIN (
  SELECT budget_line_id, SUM(quantity*COALESCE(unit_price,0)) spent
  FROM material_transactions
  WHERE type='IN' AND voided_at IS NULL GROUP BY 1
) m ON m.budget_line_id = bl.id
WHERE bl.project_id = $1
ORDER BY bl.sort_order;

-- Live flags requiring human attention
SELECT 'geofence' AS kind, m.id, m.received_at FROM media m
  WHERE m.project_id=$1 AND m.within_geofence = FALSE
UNION ALL
SELECT 'duplicate_photo', m.id, m.received_at FROM media m
  WHERE m.project_id=$1 AND m.duplicate_of IS NOT NULL
UNION ALL
SELECT 'mock_gps', m.id, m.received_at FROM media m
  WHERE m.project_id=$1 AND m.mock_location = TRUE
UNION ALL
SELECT 'unconfirmed_delivery', mt.id, mt.created_at FROM material_transactions mt
  WHERE mt.project_id=$1 AND mt.type='IN' AND mt.voided_at IS NULL
    AND mt.supplier_confirmed_at IS NULL
    AND mt.created_at < NOW() - INTERVAL '48 hours'
ORDER BY received_at DESC;
```

---

## 11. Security, privacy and NDPA compliance

Data is stored in London. Under the **Nigeria Data Protection Act 2023**, transferring personal data out of Nigeria is prohibited by default unless the recipient is subject to a law providing adequate protection, or is bound by an approved transfer instrument — standard contractual clauses, binding corporate rules, a code of conduct or a certification mechanism. Penalties reach **₦10 million or 2% of annual gross revenue**, whichever is higher, plus possible criminal liability. The NDPR 2019 no longer applies; the NDPA together with the **GAID issued 20 March 2025** is the governing framework.

**Compliance requirements — treat as build tasks, not legal afterthoughts:**

| ID | Requirement |
|---|---|
| SEC-1 | Execute Supabase's DPA including SCCs; same for Cloudflare, Resend, Termii and any inference provider. Maintain a processor register. |
| SEC-2 | Privacy notice shown and acknowledged at signup, with a specific disclosure of cross-border storage in the UK. |
| SEC-3 | Record the lawful basis for each processing purpose. Monitoring of workers relies on legitimate interest, which must be documented with a balancing test. |
| SEC-4 | **DPIA required** before any camera deployment (P2). Complete it before hardware is ordered, not after. |
| SEC-5 | Monitor the "data controller of major importance" threshold. Once crossed: register with NDPC and appoint a DPO. |
| SEC-6 | Data subject rights: access, correction, erasure and portability endpoints. Erasure must not destroy financial records — anonymise the actor, retain the transaction. |
| SEC-7 | Breach notification workflow with NDPC timelines documented and rehearsed. |
| SEC-8 | Retention: media originals 24 months then cold storage; access logs 12 months; financial records 7 years; badge scans 12 months. |
| SEC-9 | **No biometric processing anywhere in the product.** No face recognition, no face templates, no gait analysis. Person *counting* only. This is a permanent product constraint, not a phase decision. |
| SEC-10 | Signed URLs expire in 15 minutes. Object keys are opaque UUIDs. Buckets are never public. |
| SEC-11 | Portal links: token hashed at rest, PIN required, per-recipient revocation, full access logging. |
| SEC-12 | PITR enabled on the database. Restore drill performed and documented quarterly. |

**On worker monitoring specifically:** consent obtained from an employee to their employer is legally weak everywhere, and Nigeria is no exception. Design so that consent is not the load-bearing basis — which is precisely why attendance is anonymous counting plus voluntary badge, and why face recognition is permanently excluded. This is not only a legal position; a workforce that believes it is under facial surveillance will find ways to defeat the system, and you need their cooperation more than you need their identities.

---

## 12. Non-functional requirements

| ID | Requirement |
|---|---|
| NF-1 | Cold app launch under 2.5 s on a 2 GB RAM Android 8 device |
| NF-2 | Daily report completed in under 90 seconds, measured in-product as a tracked metric |
| NF-3 | Full offline function; all reads served from local SQLite |
| NF-4 | Sync of one report with 5 photos completes within 60 s on 3G |
| NF-5 | APK under 40 MB |
| NF-6 | Data usage under 15 MB per engineer per day at default settings |
| NF-7 | Web dashboard loads in under 3 s on 5 Mbps |
| NF-8 | 99.5% monthly uptime target |
| NF-9 | Supports 10,000 projects and 100,000 media objects/day without redesign |
| NF-10 | Complete English + Pidgin UI strings; architecture supports adding Hausa, Yoruba, Igbo |
| NF-11 | All monetary values `NUMERIC`, never floating point |
| NF-12 | All timestamps `TIMESTAMPTZ`; all business dates computed in the org's timezone, never UTC-derived |

> NF-12 matters more than it looks. WAT is UTC+1, so deriving a work date from a UTC timestamp puts every evening entry after 23:00 on the wrong day.

---

## 13. Pricing

**Change from v1.0: price per organisation, not per active project.**

Per-project pricing has churn built into it — the customer finishes a building and stops paying, which is churn caused by success rather than dissatisfaction. It also invites gaming, as contractors consolidate three sites into one "project" to stay in a lower tier.

| Tier | Price/month | Includes |
|---|---|---|
| **Starter** | ₦45,000 | 2 active projects, 5 users, core reporting, client portal |
| **Growth** | ₦120,000 | 6 active projects, 20 users, budget lines, AI receipt OCR, anomaly alerts |
| **Pro** | ₦280,000 | Unlimited projects, unlimited users, supplier confirmation, full AI suite, API |
| **Sites** **[P2]** | Growth/Pro + hardware | Camera package: gateway, cameras, solar, install, per-site monthly |

Annual billing at 20% discount, which also solves the gap between projects. Archived projects do not count against the tier limit, so customers are never punished for finishing work.

**Hardware in P2 is sold as a monthly site fee including equipment, not as capex.** Nigerian SMEs will not write a capital cheque for cameras, and a rental model keeps you owning the hardware that generates your training data.

---

## 14. Build sequence

| Milestone | Contents | Gate to pass |
|---|---|---|
| **M0** | Supabase project, schema, RLS, auth, CI, WhatsApp BSP application started | RLS penetration test passes: a user of org A cannot read any row of org B by any route |
| **M1** | Projects, budget lines, tasks, members | Admin creates a project with budget lines on web |
| **M2** | Daily report + media pipeline + offline sync | Engineer submits a report in airplane mode; it syncs cleanly; retries create no duplicates |
| **M3** | Materials + expenses + approvals | Balances never go negative; voids reverse correctly; every write is audited |
| **M4** | AI-1 (phash), AI-2 (OCR), AI-3 (quality gate) | A resubmitted old photo is flagged automatically |
| **M5** | Client portal + notifications | Client opens portal with PIN; weekly WhatsApp summary delivers |
| **M6** | Dashboards, variance alerts, AI-4/5/6 | Budget variance alert fires before overspend |
| **M7** | Pilot on two live sites | 21 consecutive days of reports from a site the founder does not control |

**M7 is the real gate.** Run it on your own projects first, and specifically instruct someone to try to defeat the system. What they find is worth more than another month of features.

---

## 15. Acceptance criteria for launch

| ID | Criterion |
|---|---|
| AC-1 | An engineer submits a complete daily report fully offline; it syncs on reconnection with no duplicates and no data loss |
| AC-2 | Every photo carries a visible watermark on the display derivative and an unmodified original with EXIF intact |
| AC-3 | A photo resubmitted from a previous report is automatically flagged as a duplicate |
| AC-4 | Material balances are always accurate and can never go negative |
| AC-5 | Budget vs actual is available **per budget line**, not only in total |
| AC-6 | A user of organisation A cannot read a single row belonging to organisation B by any route, verified by automated test against the API and the database directly |
| AC-7 | A client opens the portal with link + PIN and no account; the link is revocable and every access is logged |
| AC-8 | Expenses above the configured threshold cannot be recorded as spent without approval |
| AC-9 | Every void, approval and budget reallocation appears in the audit log with actor, timestamp and reason |
| AC-10 | The app functions on Android 8 with 2 GB RAM on a 3G connection |
| AC-11 | Median daily report completion time is under 90 seconds across pilot users |
| AC-12 | No biometric data is collected, stored or processed anywhere in the system |
| AC-13 | PITR is enabled and a restore has been successfully performed and documented |
| AC-14 | A budget line variance alert fires correctly before the line is exhausted |

---

## 16. Open questions for the founder

1. **What is the pilot customer's actual material fraud loss?** Everything in Section 7 is sized against an assumption. One real number changes the priority order.
2. **Will a contractor accept supplier confirmation (F-6.9)?** It requires giving you the supplier's phone number, which some will resist precisely because the relationship is the problem.
3. **What happens to a project already 40% built when they sign up?** There is no onboarding path for mid-flight projects, and nobody buys software on the day they break ground.
4. **Is the Client persona a buyer?** A developer selling units to off-takers might pay for the portal alone. That could be a cheaper, faster wedge than selling to contractors.
5. **Camera capex per site?** Needed before the P2 pricing tier can be set.
6. **English or Pidgin as the default engineer-facing language?** This materially affects adoption and should be decided from the pilot, not from the office.

---

*End of document.*
