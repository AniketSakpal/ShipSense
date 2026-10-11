# ShipSense

ShipSense is a TypeScript/Node.js backend for courier webhook ingestion,
shipment tracking, customer notification orchestration, and non-delivery
report (NDR) handling for a D2C e-pharmacy.

## Scope

-   **Part A:** SwiftShip and BlueRoute webhook signature validation,
    durable event ingestion, deduplication, status normalization, and
    retryable processing.
-   **Part B:** canonical shipment state and event timeline with
    event-time ordering.
-   **Part C:** PostgreSQL notification outbox, quiet-hour scheduling,
    stubbed provider delivery, retries, fallback, dead-letter
    inspection, and replay.
-   **Part D:** seeded chaos replay comparing
    randomized/concurrent/duplicated event delivery with an in-order
    baseline.
-   **Part E --- Option 1:** configurable NDR decisions, customer
    responses, deadline escalation, and retryable stubbed courier
    actions.

Option 2 (returns inventory, stock ledger, and COD remittance
reconciliation) is intentionally excluded.

## Technology

-   **TypeScript + Node.js + Express:** strict types and a small HTTP
    layer.
-   **PostgreSQL:** durable event storage, transactions, unique
    constraints, row locking, JSONB, and `FOR UPDATE SKIP LOCKED`.
-   **Transactional outbox:** business state and notification intent can
    commit together; provider calls are handled asynchronously.
-   **Stub providers:** no live courier or WhatsApp/SMS integration is
    required.
-   **No message broker:** PostgreSQL is sufficient for the assessment's
    durable queues and avoids an extra service. A broker can be
    considered if measured throughput requires it.

## Requirements

-   Node.js compatible with the project (Node 20 is the development
    target).
-   Docker and Docker Compose.
-   PostgreSQL via Compose or a local instance.

## Configuration

Create `.env` from `.env.example` if provided. Never commit secrets or
real customer data. The application uses environment variables for its
database connection and courier secrets; configuration may also include
`OUTBOX_ADMIN_TOKEN`, notification stub mode, and
`NDR_RESPONSE_TIMEOUT_HOURS`.

Example values for local development only:

``` dotenv
DATABASE_URL=postgres://shipsense:shipsense@localhost:5432/ship-sense
SWIFTSHIP_WEBHOOK_SECRET=replace-with-local-test-secret
BLUEROUTE_WEBHOOK_SECRET=replace-with-local-test-secret
OUTBOX_ADMIN_TOKEN=replace-with-local-admin-token
NDR_RESPONSE_TIMEOUT_HOURS=24
```

Use the exact names and credentials in `.env.example` and
`docker-compose.yml`; the example above is not a replacement for the
repository's configuration.

## Run with Docker Compose

``` bash
docker compose up --build
```

Check the service logs for database readiness, migrations/seeds, API
startup, and worker startup. If migrations, seed data, or workers are
not automatically started by Compose, use the commands defined by the
repository.

Stop the stack:

``` bash
docker compose down
```

Delete the local database volume only when you intend to remove local
test data:

``` bash
docker compose down -v
```

## Run locally

``` bash
npm install
npm run
```

Use the scripts actually listed by `npm run`. Typical conventions are:

``` bash
npm run dev
npm run build
npm test
```

Confirm these names against `package.json` before submission. Run
webhook, notification, and NDR workers using the project's configured
scripts.

### Chaos test

The chaos test must be runnable with one command, use at least 20
shipment lifecycles, randomize event order with a seed, inject
duplicates, post events concurrently, and compare final shipment states,
timelines, and notification-intent sets with an in-order sequential
baseline. It must print the seed on failure.

If the script is named `test:chaos`, run:

``` bash
npm run test:chaos
```

If the actual script name differs, update this section to match
`package.json`. Run the chaos test only against an isolated test
database.

## API overview

  Purpose                       Method and path
  ----------------------------- ---------------------------------
  SwiftShip webhook             `POST /webhooks/swiftship`
  BlueRoute webhook             `POST /webhooks/blueroute`
  Register shipment             `POST /shipments`
  Get shipment                  `GET /shipments/:awb`
  Get shipment timeline         `GET /shipments/:awb/timeline`
  Submit NDR response           `POST /v1/ndr/:awb/response`
  Inspect notification outbox   `GET /outbox?status=`
  Replay outbox item            `POST /admin/outbox/:id/replay`

Verify exact route prefixes in `src/app.ts`. Outbox administration uses
a configured bearer token.

## Important behavior

-   SwiftShip HMAC-SHA256 uses the exact raw request body.
-   BlueRoute signs the timestamp and raw body and rejects timestamps
    more than five minutes from the service clock.
-   SwiftShip event time is interpreted as IST; BlueRoute time is Unix
    epoch milliseconds.
-   Unknown status codes are surfaced as processing failures, not mapped
    to guessed states.
-   Unknown AWBs are retained for reconciliation/retry.
-   Timeline rows are deduplicated, ordered by event time with a
    deterministic tie-breaker, and late older events do not regress
    current state.
-   Notification intents are persisted transactionally; stale intents
    are dropped with a reason, and quiet hours are 21:00--08:00 IST.
-   NDR rules are stored in `public.ndr_rules`; cases are idempotent per
    `(awb, attempt_no)`.
-   The default NDR response window is 24 hours. Three attempts is the
    maximum; attempt three selects RTO.
-   Courier actions use a stub adapter and a retryable database queue.
-   Deadline escalation is intended to run as a periodic check inside
    the existing NDR worker loop, avoiding a separate process.

## Test checklist

Before submission, run `npx tsc --noEmit`, the full test suite, and the
chaos test against a clean test database. Verify invalid signatures,
stale timestamps, malformed payloads, unknown statuses, duplicates,
unmatched AWBs, out-of-order events, quiet hours, stale notification
dropping, retries/fallback, dead-letter replay, worker concurrency, NDR
responses, third-attempt RTO, courier-action retry, and deadline
escalation. Start the complete stack with `docker compose up --build`.

Do not claim tests passed unless they were run against the final
checkout.

## Design documents

-   [`DESIGN.md`](DESIGN.md): architecture, correctness, failure modes,
    capacity reasoning, and observability.
-   [`ASSUMPTIONS.md`](ASSUMPTIONS.md): ambiguity log, decisions, and
    risks.

## AI usage

AI assistance was used for implementation planning, TypeScript
debugging, and documentation drafting. Suggestions were checked against
the existing code and database schema before integration.

One concrete change was to avoid adding a separate NDR deadline process.
The implementation plan was simplified to run an idempotent deadline
query from the existing NDR worker loop, reducing operational moving
parts. Another important integration choice was to pass the existing
PostgreSQL transaction client into NDR case creation and courier-action
enqueueing rather than using unrelated pool queries; this keeps those
writes atomic with the webhook timeline transaction.

AI-generated code is not treated as proof of correctness. The developer
must compile the final checkout and run its tests.

## What I would improve with more time

-   Add integration tests for rollback and multi-worker races.
-   Load-test the 40× burst and measure lock contention, connection-pool
    saturation, and queue age.
-   Add metrics/alerts for webhook lag, retries, dead letters, and NDR
    deadline lag.
-   Add a state-rebuild command that replays the event log and compares
    it with materialized shipment state.
-   Replace stubs with real adapters that support provider idempotency
    and reconciliation.
-   Complete production reviews for retention, secret rotation, and
    access control.
