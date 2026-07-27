# SiteLens mobile (Flutter) — field app

Offline-first daily reporting (Android 8+). **This is a code-complete scaffold of the
offline architecture; it has not been built/run on the dev box** (no Flutter SDK there).
Build it in a Flutter environment.

## The offline guarantee (AC-1)
Local SQLite (Drift) is the source of truth; the engineer is never blocked on the
network. Every record is a **client-generated UUIDv7** and every mutation carries an
**idempotency_key**. The sync worker drains an outbox on reconnect and calls the M4
server functions (`fn_submit_daily_report`, `fn_register_media`). Because the server
**no-ops a duplicate idempotency_key**, a resend after a lost ack over 3G creates nothing
new. That server behaviour is verified in `supabase/tests/ac1_offline_sync.sql`.

## Architecture
```
lib/core/ids.dart                     UUIDv7 + idempotency keys (§13.2)
lib/db/database.dart                  Drift: DailyReportsLocal, MediaLocal, Outbox (source of truth)
lib/api/api_client.dart               Supabase RPC (retryable vs permanent errors)
lib/sync/sync_worker.dart             drain outbox on reconnect; exponential backoff
lib/features/daily_report/            write report locally + enqueue (never blocks)
lib/features/camera/capture_service   3 derivatives (thumb/display/original), aHash phash (§5.3)
lib/main.dart                         minimal form + reconnect-drain loop
```

## Run (in a Flutter env)
```bash
cd apps/mobile
flutter pub get
dart run build_runner build      # generates database.g.dart
flutter run --dart-define=SUPABASE_URL=http://10.0.2.2:54321 \
            --dart-define=SUPABASE_ANON_KEY=<anon key from `supabase status`>
# 10.0.2.2 = host loopback from the Android emulator
```

## Still to wire (M4 polish / later)
- Phone-OTP login + session token into `ApiClient.accessToken`, org id into `SyncWorker`.
- Camera screen (in-app capture only, gallery disabled — F-9.3) calling `CaptureService`,
  then `fn_register_media` enqueued before the report references the media ids.
- Media upload to the `report-media` bucket (thumbs first, originals on Wi-Fi — §13.4).
- Manpower-by-trade, weather auto/manual, task/stage progress fields (F-9.2).
