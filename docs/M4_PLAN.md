# M4 plan — Daily report + media pipeline + offline sync

> Milestone flipped M3→M4. Building through. **Reality note:** M4 introduces the Flutter
> mobile app. Flutter cannot be built or run on this box (no SDK, slow network). So the
> **sync backend + the AC-1 no-duplicate guarantee are fully DB-verified here**, and the
> **Flutter app is scaffolded code-complete** (core offline architecture), to be built in
> a Flutter environment.

## Gate (AC-1)
An engineer submits a complete daily report **fully offline**; it **syncs with no
duplicates and no loss**. (§9 F-9, §13 offline-first, §5.3 media.)

## The offline model (§13)
- Local SQLite (Drift) is the **source of truth** on device; the app never blocks on the
  network. An **outbox** holds pending mutations; a sync worker drains it on reconnect.
- All IDs are **client-generated UUIDv7**; every mutation carries an **`idempotency_key`**
  the server enforces unique — this is what stops a flaky-3G retry duplicating a report.
- Daily reports are **versioned**: a second submission for the same (project, date)
  amends and creates a new version, never overwrites (§13.3).
- Media queues **separately** with its own retry; a report is visible once `thumb`s
  upload; `original`s continue in the background (§13.4). Three derivatives
  (thumb/display/original) — the display is watermarked, the original untouched (§5.3).

## Workstreams
- **A — sync backend (DB, Rule 1):** `fn_register_media` (idempotent on client id;
  computes `within_geofence` from captured point vs project geofence, `mock_location`
  flag, basic exact-`phash` duplicate flag) + a private `report-media` bucket.
  `fn_submit_daily_report` (idempotent on `idempotency_key` → a retry is a no-op;
  versions an amendment for the same date; rejects backdating > 3 days; links media +
  task progress; membership/project-access gated; status `pending`). No client write
  policy on daily_reports/media (writes via these fns).
- **B — AC-1 test (DB):** simulate the offline client — submit a report with a
  client-generated id + idempotency_key + photos, then **submit AGAIN with the same
  idempotency_key** (a lost-ack retry) and assert **exactly one** report and no duplicate
  media links (no-duplicate); a same-date amendment makes a **new version**; geofence +
  backdate flags; authz. This is the authoritative AC-1 proof.
- **C — Flutter app scaffold (code-complete, unrun):** `apps/mobile/` — Drift schema
  (DailyReports, MediaItems, Outbox), the outbox + sync worker (UUIDv7, idempotency,
  retry/backoff, calls the rpc), the daily-report form, camera capture with GPS/time/
  project stamping + three-derivative generation, and a README documenting the flow.

## Files
```
supabase/migrations/2026…_m4a_daily_report.sql   fn_register_media, fn_submit_daily_report, report-media bucket
supabase/tests/ac1_offline_sync.sql              offline submit + retry no-dup + versioning + geofence/backdate + authz
apps/mobile/                                     Flutter (Drift, outbox, sync worker, report form, camera+3 derivatives)
```

## Verification
`bash scripts/verify_all.sh` extended with `ac1_offline_sync`; all prior suites stay
green. Flutter is code-complete only (documented in `apps/mobile/README.md`).

## Decisions (noted, non-blocking — recommended defaults taken)
1. **Media derivatives generated mobile-side (upload 3), not server-side.** Bandwidth
   (NF-6 < 15 MB/day) + offline view + thumbs-first (§13.4) favour the phone generating
   thumb/display locally and uploading them first; the server stores keys + serves signed
   URLs. (Server/edge generation from the original is a later option.)
2. **Sync transport = the `fn_submit_daily_report` RPC per outbox item** (idempotency is
   in the DB fn regardless). A batched `/sync` edge function is a later optimization.
3. **Flutter is scaffolded, not built here.** The AC-1 gate is proven at the DB/sync-
   protocol layer (retry → no duplicate). Full mobile build happens in a Flutter env.
4. **`phash` duplicate flag is a basic exact match in M4;** full perceptual-hash
   near-duplicate detection (AI-1) is M6. The column + flag path exist now.
