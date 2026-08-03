# SiteLens mobile (Flutter) — the field app

The **Site Engineer's tool** (Android 8+, offline-first). One user, three jobs:
the daily report with photos (the <90 s loop, AC-14), marking stages done
(instant on the board, labelled "from field" — DECISIONS #65), and materials
IN/OUT. **No money anywhere** — engineers never see a price (Rule 1 hygiene).

## How it builds (no local Flutter SDK needed)

The dev boxes have no Flutter SDK, so **GitHub Actions is the build + correctness
gate**: `.github/workflows/mobile-apk.yml` runs `flutter analyze` and produces the
release APK as an artifact on every push touching `apps/mobile/`. Download the
`sitelens-field-app` artifact and sideload it (pilot distribution = APK, not Play
Store). The `android/` dir is generated in CI (`flutter create` +
`tool/android_setup.sh` for permissions) and is git-ignored.

One-time repo setup: add secrets `SUPABASE_URL` + `SUPABASE_ANON_KEY` (the
publishable anon key; RLS is the boundary) so the APK points at cloud.

## The offline guarantee (AC-1)
Local SQLite (Drift) is the source of truth; the engineer is never blocked on the
network. Every record is a **client-generated UUIDv7** and every mutation carries an
**idempotency_key**; the server no-ops duplicates, so a resend after a lost ack over
3G creates nothing new (verified in `supabase/tests/ac1_offline_sync.sql`).
Media pipeline (§13.4): thumb → display → `fn_register_media` → original
(Wi-Fi preferred); a report is held until its photos are registered.

## Architecture
```
lib/core/ids.dart               UUIDv7 + idempotency keys (§13.2)
lib/core/session.dart           email OTP (Termii phone later), token refresh, org claim
lib/core/theme.dart             dark command-console look, big touch targets
lib/api/api_client.dart         RPC + PostgREST reads + bucket upload; 401 → refresh+retry
lib/db/database.dart            Drift v2: reports, media, outbox, KV cache (source of truth)
lib/data/repo.dart              cached reference data + offline field mutations
lib/sync/sync_worker.dart       media pipeline + outbox drain, backoff (AC-1)
lib/features/daily_report/      write report locally + enqueue (never blocks)
lib/features/camera/            3 derivatives + burned-in stamp + aHash (§5.3, F-9.4)
lib/ui/login_screen.dart        email → 6-digit code
lib/ui/today_screen.dart        HOME: report status card + two actions + sync chip
lib/ui/report_flow_screen.dart  3 steps: houses → photos (min 3) → crew steppers → SEND
lib/ui/camera_screen.dart       in-app capture only, GPS stamp, geofence flagged not blocked
lib/ui/mark_done_screen.dart    house → stage ticks (fn_complete_stage, source='field')
lib/ui/materials_screen.dart    IN delivery / OUT to a house (AC-4 guard server-side)
lib/main.dart                   session gate + reconnect/30 s drain loop
```

## Run locally (in a Flutter env)
```bash
cd apps/mobile
flutter create --platforms=android --project-name sitelens_mobile .
bash tool/android_setup.sh
flutter pub get
dart run build_runner build      # generates database.g.dart
flutter run --dart-define=SUPABASE_URL=http://10.0.2.2:54321 \
            --dart-define=SUPABASE_ANON_KEY=<anon key from `supabase status`>
# 10.0.2.2 = host loopback from the Android emulator
```

## Provisioning a field user
Engineers sign in with **email OTP** (create_user is off — a typo'd email cannot
mint an account). The admin must first create the auth user + an `engineer`
membership; Termii phone OTP replaces email later without an app change.

## Still open (v1.x)
- Weather auto-fill when online (manual chips for now); manpower currently rides
  in the summary text until attendance (F-12) lands.
- Purge local originals 7 days after confirmed upload (§13.4 tail).
- Termii phone OTP once the send-sms hook is fixed.
