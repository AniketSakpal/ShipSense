# ShipSense --- Design

## 1. Goals and architecture

ShipSense is a TypeScript/Express backend that ingests courier webhooks,
maintains canonical shipment state and an event timeline, creates
customer-notification intents, and handles non-delivery reports (NDR).
The primary correctness requirements are resilience to duplicate,
delayed, reordered, and concurrent events.

``` text
SwiftShip / BlueRoute
        |
        v
Express webhook routes
  - raw-body signature validation
  - BlueRoute timestamp validation
  - durable webhook record / deduplication
        |
        v
PostgreSQL webhook event log
        |
        v
Webhook processing worker
  - lock pending event and shipment
  - normalize status and event time
  - insert timeline row
  - apply state only if event is newer
  - create notification intent
  - create NDR case / RTO action on delivery failure
        |
        +------------------------+
        |                        |
        v                        v
Notification outbox       NDR case + courier-action queue
        |                        |
        v                        v
Notification worker       NDR action worker
        |                        |
        v                        v
Stub WhatsApp/SMS          Stub courier adapter
```

The HTTP request verifies the courier signature and durably records the
event. Business processing and provider calls are deferred so webhook
acknowledgement does not wait for messaging or courier APIs.

### Why PostgreSQL

PostgreSQL provides ACID transactions, unique constraints, row-level
locks, JSONB, and `FOR UPDATE SKIP LOCKED`. The assessment does not
require a broker: PostgreSQL can serve as the durable queue. A broker
would add deployment and operational complexity without eliminating
idempotency requirements between event processing and database writes.

Core tables include `webhook_events`, `shipments`, `shipment_events`,
the notification outbox, `ndr_rules`, `ndr_cases`, and
`ndr_courier_actions`.

## 2. Correctness

### Authentication and ingestion

SwiftShip HMAC-SHA256 is checked against the exact raw request bytes.
BlueRoute signs the timestamp plus raw body and rejects timestamps
outside a five-minute skew window. JSON must not be re-serialized before
signature verification.

Duplicate keys are protected by database uniqueness, not only by an
in-memory cache. SwiftShip provides an event ID; BlueRoute requires a
derived key based on stable event attributes. Unknown status codes are
not mapped to guessed canonical states; they are surfaced for
investigation. Webhooks for unknown AWBs are retained for later
reconciliation/retry.

### Event ordering and shipment state

Every newly accepted unique event belongs in the timeline, including
late older events. Timeline ordering uses courier event time, with the
deduplication key as a deterministic tie-breaker. The processor locks
the shipment row while comparing the incoming event with the event
currently establishing state. Only a newer event updates
`current_status` and `last_status_event_id`; a late older event cannot
regress the materialized state. BlueRoute informational code `10` is
retained without changing canonical state.

Current state is a materialized read model; the timeline is the audit
trail. A full rebuild should replay events with the same ordering and
transition policy and compare the result with the live state.

### Transactions and idempotency

The timeline insert uses a unique `(courier_id, dedup_key)` conflict
guard. If the insert conflicts, processing treats the event as a
duplicate and skips downstream side effects.

Shipment state changes and notification-intent creation should commit in
the same transaction. NDR case creation and any RTO action should use
the same transaction client as well. Notification intent uniqueness is
defined by `(awb, notification type, attempt number)`. NDR cases are
unique by `(awb, attempt_no)`, and courier actions use stable
idempotency keys.

### Notification delivery guarantees

Workers claim due outbox rows using row locks and `SKIP LOCKED`. This
permits multiple workers to process different rows concurrently. Stale
intents are dropped with an explicit reason, for example an
`OUT_FOR_DELIVERY` intent superseded by `DELIVERED`. Quiet hours are
21:00--08:00 IST; eligible intents created during that window are
deferred until 08:00 IST. The policy applies to delivery confirmations
too, avoiding channel-specific exceptions.

Delivery uses injectable provider stubs. WhatsApp is primary; after
three failed WhatsApp attempts the worker falls back to SMS. Retries use
bounded exponential backoff with jitter, then move the intent to a
dead-letter state with inspection and replay support.

**Crash after provider success:** if a worker crashes after the provider
accepts a message but before the database records success, the system
cannot know whether delivery happened. Without provider-side idempotency
or receipt reconciliation, exactly-once external delivery is impossible.
The honest guarantee is durable at-least-once attempts with database
claim/idempotency protections; this narrow crash window can cause a
duplicate send.

## 3. NDR and COD-RTO (selected extension)

A canonical `DELIVERY_FAILED` timeline event triggers failure-reason
normalization and rule evaluation. BlueRoute codes map to
`CUSTOMER_UNAVAILABLE`, `ADDRESS_ISSUE`, `REFUSED`, `COD_NOT_READY`, or
`PREMISES_CLOSED`; unrecognized values become `OTHER`. SwiftShip free
text is accepted only when it matches a recognized canonical value.

Rules are stored in `ndr_rules` with priority, conditions, enabled
state, action, and description. Each case records the selected rule,
metadata, and human-readable explanation. `(awb, attempt_no)` ensures
case idempotency. Attempt three or later selects RTO. Courier actions
are stored durably, sent through a stub adapter, retried with bounded
backoff, and dead-lettered after the configured maximum.

Customer responses use `POST /v1/ndr/:awb/response`. Responses are
validated against the case status and deadline. Expired
`AWAITING_CUSTOMER` cases are atomically changed to `ESCALATED` by a
periodic check in the existing NDR worker loop. This avoids another
service process. If the worker is down, escalation is delayed until it
resumes; deadline lag should be monitored.

The current decision inputs include failure reason, attempt number,
payment mode, and COD amount. Do not claim customer-history-based
scoring unless a stubbed customer history and matching rules are
actually implemented.

## 4. Failure-mode table

  ----------------------------------------------------------------------------
  Failure                 Behavior                Recovery / risk
  ----------------------- ----------------------- ----------------------------
  PostgreSQL unavailable  Cannot durably accept   Restore DB and monitor
  during ingestion        the event; return       courier retry windows.
                          non-2xx so the courier  
                          can retry.              

  DB failure during       Transaction rolls back; Retry according to worker
  processing              no partial              policy.
                          timeline/outbox/NDR     
                          commit.                 

  Worker dies before      Row remains processing  Configure recovery timeout
  provider call           until stale-claim       and monitor stale processing
                          recovery makes it       rows.
                          eligible again.         

  Worker dies after       DB cannot determine     Retry may duplicate delivery
  provider success but    whether provider sent   unless provider
  before DB success       the message.            idempotency/reconciliation
                                                  exists.

  Provider slow or times  Adapter returns         Use timeouts and cap
  out                     timeout/failure; worker in-flight work; dead-letter
                          retries with bounded    after maximum attempts.
                          backoff and jitter.     

  Courier floods service  Durable ingestion       Scale workers carefully,
                          queues work; worker     monitor queue age, and add
                          throughput and DB       rate limits if needed.
                          writes/locks become     
                          bottlenecks.            

  Duplicate webhook       Unique keys suppress    Detect
                          duplicate timeline side same-ID/different-payload
                          effects.                conflicts and alert.

  Unknown AWB             Event is retained and   Alert on aged unmatched
                          deferred for            events.
                          reconciliation/retry.   

  Deadline worker stopped Expired NDR cases wait  Monitor overdue-case count
                          until a deadline check  and deadline lag.
                          runs again.             
  ----------------------------------------------------------------------------

## 5. Capacity reasoning

Assumed workload: 50,000 shipments/day × 6 events each = **300,000
events/day**.

-   Average: 300,000 / 86,400 ≈ **3.5 events/second**.
-   A 40× burst relative to that average: about **139 events/second**.
-   A 30-minute interval at the average rate contains about 6,250
    events; at 40× it contains about 250,000, or roughly 244,000
    additional events above average.

These are planning estimates, not benchmark results. The first likely
bottlenecks are PostgreSQL write/lock contention, unique-conflict checks
and indexes on append-heavy tables, connection-pool saturation, and
notification-provider throughput. Per-shipment row locks serialize
events for one shipment while allowing unrelated shipments to proceed
concurrently.

Going from 2 to 10 couriers increases aggregate traffic and the number
of payload/signature adapters. Keep courier-specific authentication and
parsing isolated from canonical processing. Add indexes aligned with
due-work scans and event lookups, monitor backlog age and DB pool/lock
metrics, and scale worker concurrency only while PostgreSQL remains
healthy. If one database becomes the limit, consider partitioning
append-only event tables by time/courier, archiving under a retention
policy, and introducing a broker only when measured queue throughput or
workload isolation justifies it.

## 6. Observability

Use structured logs with webhook event ID, courier ID, internal shipment
ID or AWB hash, timeline event ID, outbox ID, and NDR case ID. Do not
log secrets, full phone numbers, medicine names, order contents, or raw
signed payloads at normal log levels.

Measure:

-   Webhook requests by courier/outcome: accepted, invalid signature,
    duplicate, unknown code, unmatched AWB.
-   Oldest pending webhook age and processing latency.
-   Timeline dedup conflicts and state decisions by `decision_reason`.
-   Notification outbox depth, retry counts, channel, provider
    latency/timeouts, and dead-letter count.
-   NDR cases by status, overdue cases, deadline lag, courier-action
    retries, and dead letters.
-   PostgreSQL pool utilization, transaction latency, lock waits, CPU,
    and storage.

Alert on sustained backlog, aged unmatched AWBs, dead-letter growth,
overdue NDR cases, invalid-signature spikes, and worker/database
saturation.

## 7. Scope cuts

-   No real courier or messaging-provider integrations.
-   No Kafka/RabbitMQ or Redis; PostgreSQL is used as the durable queue.
-   Option 2 returns inventory, stock ledger, and COD remittance
    reconciliation are excluded.
-   No general user-management system; outbox admin uses a configured
    bearer token.
-   Full state-rebuild tooling and load testing are not claimed unless
    present in the final repository.
