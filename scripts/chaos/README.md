# ShipSense Part D chaos test

Run against a disposable/test database with the normal migrations and mappings applied and the API/worker running.

```bash
npm install --save-dev tsx
npx tsx scripts/chaos-test.ts --seed 12345 --shipments 25 --concurrency 8
```

The script registers independent baseline (`CHB...`) and chaos (`CHC...`) shipment fixtures, posts signed SwiftShip events through `/v1/webhooks/swiftship`, and snapshots data through PostgreSQL. The baseline is submitted in chronological order and waits for each event to reach `PROCESSED`; chaos uses a deterministic shuffle, 20% duplicate requests, and concurrent HTTP requests and event processors.

Configuration:
- `CHAOS_BASE_URL` (default `http://localhost:3000`)
- `CHAOS_SWIFTSHIP_SECRET` (preferred), or `SWIFTSHIP_WEBHOOK_SECRET` / `SWIFTSHIP_SECRET`
- CLI `--seed`, `--shipments` (minimum 20), `--concurrency`, `--base-url`

Only use a disposable test database. Do not run this against production: it creates shipments and webhook events and does not delete them.

The comparison intentionally includes `state_changed`, `decision_reason`, and notification intent payload/attempt/channel. A failure is meaningful; don't weaken assertions to force a pass. The assignment requires a seeded reproducible test with final state, timeline, and intent-set equality.

