# ShipSense --- Assumptions and Decisions Log

This log captures ambiguous requirements, the decision made, and the
cost if the assumption is wrong. Compare it with the final source and
revise any statement the code does not enforce.

  --------------------------------------------------------------------------------------------------
  \#                Ambiguity          Decision                       Cost if wrong
  ----------------- ------------------ ------------------------------ ------------------------------
  1                 Events may have    Order by courier event time,   The key may not reflect
                    equal timestamps.  then `dedup_key` as a          real-world causal order.
                                       deterministic tie-breaker.     

  2                 Older events may   Keep unique events in the      Incorrect courier timestamps
                    arrive after newer timeline, but only a newer     can select the wrong current
                    events.            ordered event updates current  state.
                                       state.                         

  3                 Webhook AWB may    Retain the event and mark it   Unmatched records can
                    not yet be         unmatched/retryable for later  accumulate if registration
                    registered.        reconciliation.                never arrives.

  4                 SwiftShip has an   Use SwiftShip event ID; derive A derived key can collide for
                    event ID;          a stable BlueRoute key from    legitimate events with
                    BlueRoute does     event attributes.              identical attributes.
                    not.                                              

  5                 SwiftShip may      Treat the event ID as the      Without conflict detection,
                    reuse an event ID  identity and surface           courier corrections can be
                    with different     conflicting payload reuse      silently missed.
                    content.           rather than overwriting the    
                                       original. Verify conflict      
                                       detection is implemented.      

  6                 Unknown status     Do not guess a state; preserve Repeated retries may create
                    codes have no      the event and expose a         noise; a
                    canonical mapping. processing failure.            quarantine/manual-resolution
                                                                      policy may be needed.

  7                 BlueRoute code     Retain it in the timeline      Changed courier semantics
                    `10` is            without changing canonical     require a mapping update.
                    informational.     shipment state.                

  8                 Two couriers may   Process by the configured      Conflicting facts may lead to
                    report conflicting courier/AWB identity; no       an incorrect state; production
                    facts for one      cross-courier arbitration      needs source precedence.
                    order.             policy is added.               

  9                 `DELIVERED` may be The generic event-time rule    Some business flows may
                    followed by later  applies unless the code        require manual review of
                    `RTO_INITIATED`.   explicitly enforces a          contradictory later events.
                                       terminal-state policy.         

  10                Courier attempt    Derive attempts from ordered   Missing OFD events can
                    numbers may be     `OUT_FOR_DELIVERY` timeline    miscount attempts and affect
                    absent or          events; use a defensive        RTO.
                    inconsistent.      minimum of one for a failed    
                                       delivery without an earlier    
                                       OFD event.                     

  11                Failure-reason     Map known BlueRoute reason     Valid courier wording may be
                    formats differ.    codes and recognized canonical classified as `OTHER`.
                                       SwiftShip values; unknown/free 
                                       text becomes `OTHER`.          

  12                Couriers represent Use integer paise internally;  Incorrect parsing could affect
                    money differently. convert decimal-string money   COD decisions; test fractional
                                       at the adapter boundary.       and malformed inputs.

  13                Notification       Enforce uniqueness per AWB,    Incorrect attempt derivation
                    intent uniqueness  notification type, and attempt can suppress or duplicate a
                    is expressed as a  number. Shipment-level intents valid notification.
                    business key.      use attempt zero where         
                                       appropriate.                   

  14                Whether            Apply 21:00--08:00 IST quiet   Confirmation may arrive later;
                    `DELIVERED` is     hours to all customer          an exception would require an
                    subject to quiet   WhatsApp/SMS notifications,    explicit policy change.
                    hours is           including delivery             
                    unspecified.       confirmation.                  

  15                Worker may crash   Use durable retry and database A customer may receive a
                    after provider     idempotency, but do not claim  duplicate notification in this
                    success but before exactly-once external          crash window.
                    DB success.        delivery. A retry may          
                                       duplicate the send without     
                                       provider idempotency or        
                                       receipt reconciliation.        

  16                Real provider      Use injectable stub adapters   Stubs cannot prove real
                    integrations are   for success, failure, timeout, provider latency, receipt, or
                    not required.      and slow responses.            idempotency semantics.

  17                Outbox replay      Protect outbox admin routes    Token rotation, audit policy,
                    needs admin        with a configured bearer token and fine-grained authorization
                    access; user       and constant-time comparison.  remain production concerns.
                    management is out                                 
                    of scope.                                         

  18                NDR rules should   Store rules in `ndr_rules`     Bad configuration can produce
                    be configurable.   with priority, conditions,     bad decisions; rule edits do
                                       enabled state, action, and     not retroactively alter
                                       description; save a            existing cases.
                                       human-readable decision        
                                       explanation.                   

  19                NDR case creation  Enforce one case per           If attempt calculation
                    must be            `(awb, attempt_no)` and use    changes, the same physical
                    idempotent.        stable idempotency keys for    attempt might be assigned a
                                       courier actions.               different key.

  20                Maximum attempts   Attempt three or later selects A courier using zero-based
                    are three.         RTO.                           attempts or missing OFD events
                                                                      requires normalization.

  21                Response deadline  Use                            Bad configuration can escalate
                    is configurable    `NDR_RESPONSE_TIMEOUT_HOURS`   too early or late.
                    with a 24-hour     if configured; otherwise use   
                    default.           24 hours and validate bounds.  

  22                Automatic          Run an idempotent deadline     If the worker is stopped,
                    escalation is      update periodically from the   escalation is delayed until it
                    required, but      existing NDR worker loop       resumes. Monitor deadline lag.
                    scheduler          instead of adding a separate   
                    architecture is    process.                       
                    unspecified.                                      

  23                The NDR            Do not claim history-based     The engine may miss a useful
                    description        scoring unless a history       risk signal until customer
                    mentions past      source and matching rules are  history is added.
                    customer RTO       implemented. Current decisions 
                    history.           use available rule inputs.     

  24                Courier actions    Queue actions durably, use     A real courier may have
                    can fail or time   stable idempotency keys,       performed an action despite a
                    out.               bounded retries/backoff, and   timeout; production adapters
                                       dead-letter after the maximum. need reconciliation.

  25                Expected load is   Estimate 300,000 events/day    Real payload sizes, hardware,
                    specified but load (50,000 × 6), about 3.5        indexes, and lock contention
                    testing is not     events/s average and about 139 may change capacity.
                    required.          events/s at a 40× burst. These 
                                       are estimates, not measured    
                                       results.                       

  26                Retention period   Retain webhook events for      Short retention harms
                    is unspecified.    audit under a configurable     investigations; long retention
                                       policy; do not log raw         increases privacy/storage
                                       payloads or full phone         risk.
                                       numbers.                       

  27                Only one extension Select Option 1, NDR and       Returned-medicine
                    is requested.      COD-RTO; omit returns stock    quarantine/restocking and
                                       ledger and COD remittance      courier remittance differences
                                       reconciliation.                are not modeled.

  28                AI assistance is   Use AI for planning,           Unreviewed generated code can
                    allowed, but       debugging, and drafting, then  mismatch the schema, break
                    suggestions can be check against actual           transaction boundaries, or
                    incorrect or       code/schema. One proposed      overstate test coverage.
                    overcomplicated.   separate deadline process was  
                                       simplified to use the existing 
                                       worker loop.                   
  --------------------------------------------------------------------------------------------------

## Final verification checklist

Before submission, verify these assumptions against the final code and
tests:

-   BlueRoute deduplication and same-ID/different-payload conflict
    behavior.
-   Actual unique constraints on timeline and notification-intent
    tables.
-   Whether customer RTO history is implemented or deferred.
-   Deadline escalation is called from the running worker loop.
-   Actual retry limits, dead-letter statuses, quiet-hour rules, and npm
    script names.
-   Chaos test uses at least 20 realistic shipment lifecycles, random
    seeded ordering, duplicate injection, concurrent posting, baseline
    comparison for final state/timeline/notification-intent sets, and
    prints the seed on failure.

Do not describe a behavior as implemented merely because it is listed
here; update this log if the final code differs.
