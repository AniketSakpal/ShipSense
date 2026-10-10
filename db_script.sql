BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =========================================================
-- 1. ENUM TYPES
-- =========================================================

CREATE TYPE shipment_status AS ENUM (
    'CREATED',
    'PICKED_UP',
    'IN_TRANSIT',
    'OUT_FOR_DELIVERY',
    'DELIVERY_FAILED',
    'DELIVERED',
    'RTO_INITIATED',
    'RTO_DELIVERED',
    'LOST'
);

CREATE TYPE payment_mode AS ENUM (
    'COD',
    'PREPAID'
);

CREATE TYPE webhook_processing_status AS ENUM (
    'RECEIVED',
    'PROCESSING',
    'PROCESSED',
    'FAILED',
    'IGNORED'
);

CREATE TYPE notification_status AS ENUM (
    'PENDING',
    'PROCESSING',
    'SENT',
    'FAILED'
);


-- =========================================================
-- 2. COURIERS
-- =========================================================

CREATE TABLE couriers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,

    webhook_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =========================================================
-- 3. COURIER STATUS MAPPINGS
-- Maps courier-specific status codes to ShipSense statuses.
-- =========================================================

CREATE TABLE courier_status_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    courier_id UUID NOT NULL
        REFERENCES couriers(id) ON DELETE RESTRICT,

    external_status_code VARCHAR(100) NOT NULL,
    internal_status shipment_status NOT NULL,

    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_courier_external_status
        UNIQUE (courier_id, external_status_code)
);

CREATE INDEX idx_courier_status_mappings_internal_status
    ON courier_status_mappings (internal_status);


-- =========================================================
-- 4. SHIPMENTS
-- One row represents one registered shipment / AWB.
-- =========================================================

CREATE TABLE shipments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    courier_id UUID NOT NULL
        REFERENCES couriers(id) ON DELETE RESTRICT,

    awb VARCHAR(120) NOT NULL,

    order_ref VARCHAR(150) NOT NULL,
    customer_ref VARCHAR(150) NOT NULL,
    customer_phone VARCHAR(30) NOT NULL,

    payment_mode payment_mode NOT NULL,
    cod_amount_paise BIGINT NOT NULL DEFAULT 0,

    current_status shipment_status NOT NULL DEFAULT 'CREATED',

    -- Used to identify the event that last changed the projection.
    last_status_event_id UUID,

    registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_courier_awb
        UNIQUE (courier_id, awb),

    CONSTRAINT chk_cod_amount_nonnegative
        CHECK (cod_amount_paise >= 0),

    CONSTRAINT chk_prepaid_cod_amount
        CHECK (
            payment_mode <> 'PREPAID'
            OR cod_amount_paise = 0
        )
);

CREATE INDEX idx_shipments_order_ref
    ON shipments (order_ref);

CREATE INDEX idx_shipments_customer_ref
    ON shipments (customer_ref);

CREATE INDEX idx_shipments_status_registered
    ON shipments (current_status, registered_at DESC);

CREATE INDEX idx_shipments_courier_status
    ON shipments (courier_id, current_status);

CREATE INDEX idx_shipments_registered_at
    ON shipments (registered_at DESC);


-- =========================================================
-- 5. WEBHOOK EVENTS
-- One row per HTTP webhook receipt.
-- Duplicate deliveries are intentionally retained.
-- =========================================================

CREATE TABLE webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    courier_id UUID NOT NULL
        REFERENCES couriers(id) ON DELETE RESTRICT,

    -- Courier's own event identifier, if supplied.
    external_event_id VARCHAR(200),

    -- Exact request body can be retained for signature verification
    -- and forensic debugging. Protect access to this data.
    raw_body BYTEA NOT NULL,

    -- Parsed JSON representation for querying and debugging.
    payload JSONB NOT NULL,

    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    signature_valid BOOLEAN NOT NULL DEFAULT FALSE,

    processing_status webhook_processing_status
        NOT NULL DEFAULT 'RECEIVED',

    processing_attempts INTEGER NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMPTZ,
    processed_at TIMESTAMPTZ,
    last_error TEXT,

    CONSTRAINT chk_webhook_attempts
        CHECK (processing_attempts >= 0)
);

CREATE INDEX idx_webhook_events_pending
    ON webhook_events (received_at)
    WHERE processing_status IN ('RECEIVED', 'FAILED');

CREATE INDEX idx_webhook_events_courier_received
    ON webhook_events (courier_id, received_at DESC);

CREATE INDEX idx_webhook_events_external_id
    ON webhook_events (courier_id, external_event_id)
    WHERE external_event_id IS NOT NULL;

CREATE INDEX idx_webhook_events_payload_gin
    ON webhook_events USING GIN (payload);


-- =========================================================
-- 6. WEBHOOK DELIVERY / PROCESSING ATTEMPTS
-- Tracks each attempt to process a received webhook.
-- =========================================================

CREATE TABLE webhook_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    webhook_event_id UUID NOT NULL
        REFERENCES webhook_events(id) ON DELETE RESTRICT,

    attempt_number INTEGER NOT NULL,

    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,

    succeeded BOOLEAN NOT NULL DEFAULT FALSE,
    error_message TEXT,

    CONSTRAINT uq_webhook_attempt
        UNIQUE (webhook_event_id, attempt_number),

    CONSTRAINT chk_webhook_attempt_number
        CHECK (attempt_number > 0),

    CONSTRAINT chk_webhook_attempt_time
        CHECK (
            finished_at IS NULL
            OR finished_at >= started_at
        )
);

CREATE INDEX idx_webhook_deliveries_event
    ON webhook_deliveries (webhook_event_id, attempt_number DESC);


-- =========================================================
-- 7. NORMALIZED SHIPMENT EVENTS
-- One row per unique logical tracking event.
-- =========================================================

CREATE TABLE shipment_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    shipment_id UUID NOT NULL
        REFERENCES shipments(id) ON DELETE RESTRICT,

    courier_id UUID NOT NULL
        REFERENCES couriers(id) ON DELETE RESTRICT,

    webhook_event_id UUID NOT NULL
        REFERENCES webhook_events(id) ON DELETE RESTRICT,

    -- Prefer courier's event ID; otherwise derive a stable
    -- fingerprint from documented event identity fields.
    dedup_key VARCHAR(300) NOT NULL,

    external_event_id VARCHAR(200),

    status shipment_status NOT NULL,

    -- Time the courier says the event happened.
    event_time TIMESTAMPTZ NOT NULL,

    -- Time ShipSense received the webhook.
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    location TEXT,
    description TEXT,

    -- Whether this event was accepted by the state reducer.
    state_changed BOOLEAN NOT NULL DEFAULT FALSE,

    -- Examples: APPLIED, DUPLICATE, STALE_EVENT,
    -- CONFLICT_WITH_DELIVERED, UNKNOWN_MAPPING.
    decision_reason VARCHAR(100) NOT NULL,

    -- Additional normalized fields for audit and diagnostics.
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_shipment_event_dedup
        UNIQUE (courier_id, dedup_key),

    CONSTRAINT uq_shipment_event_webhook
        UNIQUE (webhook_event_id, dedup_key)
);

CREATE INDEX idx_shipment_events_timeline
    ON shipment_events (shipment_id, event_time, id);

CREATE INDEX idx_shipment_events_courier_time
    ON shipment_events (courier_id, event_time DESC);

CREATE INDEX idx_shipment_events_status_time
    ON shipment_events (status, event_time DESC);

CREATE INDEX idx_shipment_events_webhook
    ON shipment_events (webhook_event_id);


-- =========================================================
-- 8. SHIPMENT STATUS HISTORY
-- Records accepted changes to shipments.current_status.
-- =========================================================

CREATE TABLE shipment_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    shipment_id UUID NOT NULL
        REFERENCES shipments(id) ON DELETE RESTRICT,

    shipment_event_id UUID NOT NULL
        REFERENCES shipment_events(id) ON DELETE RESTRICT,

    previous_status shipment_status,
    new_status shipment_status NOT NULL,

    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_status_history_event
        UNIQUE (shipment_event_id),

    CONSTRAINT chk_status_history_changed
        CHECK (
            previous_status IS NULL
            OR previous_status <> new_status
        )
);

CREATE INDEX idx_status_history_timeline
    ON shipment_status_history (shipment_id, changed_at, id);

CREATE INDEX idx_status_history_new_status
    ON shipment_status_history (new_status, changed_at DESC);


-- Link the current projection to its latest state-changing event.
ALTER TABLE shipments
    ADD CONSTRAINT fk_shipments_last_status_event
    FOREIGN KEY (last_status_event_id)
    REFERENCES shipment_events(id)
    ON DELETE RESTRICT;


-- =========================================================
-- 9. NOTIFICATION OUTBOX
-- Stores notification intent in the same DB transaction as
-- the state change. A worker delivers notifications later.
-- =========================================================

CREATE TABLE notification_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    shipment_id UUID NOT NULL
        REFERENCES shipments(id) ON DELETE RESTRICT,

    shipment_event_id UUID NOT NULL
        REFERENCES shipment_events(id) ON DELETE RESTRICT,

    notification_type VARCHAR(100) NOT NULL,
    recipient VARCHAR(255) NOT NULL,

    payload JSONB NOT NULL DEFAULT '{}'::JSONB,

    status notification_status NOT NULL DEFAULT 'PENDING',

    attempts INTEGER NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ,
    last_error TEXT,

    CONSTRAINT uq_notification_intent
        UNIQUE (shipment_event_id, notification_type, recipient),

    CONSTRAINT chk_notification_attempts
        CHECK (attempts >= 0)
);

CREATE INDEX idx_notification_outbox_pending
    ON notification_outbox (created_at)
    WHERE status IN ('PENDING', 'FAILED');

CREATE INDEX idx_notification_outbox_retry
    ON notification_outbox (next_retry_at)
    WHERE status = 'FAILED';

CREATE INDEX idx_notification_outbox_shipment
    ON notification_outbox (shipment_id, created_at DESC);


CREATE TABLE webhook_configurations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    courier_id UUID NOT NULL
        REFERENCES couriers(id) ON DELETE RESTRICT,

    config_name VARCHAR(100) NOT NULL,
    environment VARCHAR(20) NOT NULL DEFAULT 'PRODUCTION',

    -- Endpoint exposed by ShipSense to receive courier callbacks.
    endpoint_path VARCHAR(255) NOT NULL,

    -- Authentication and signature-verification settings.
    auth_type VARCHAR(30) NOT NULL DEFAULT 'HMAC_SHA256',
    secret_reference TEXT,

    -- Optional IP allowlist or additional configuration.
    allowed_source_ips INET[] NOT NULL DEFAULT '{}',

    -- Webhook processing controls.
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    timeout_seconds INTEGER NOT NULL DEFAULT 10,
    max_retries INTEGER NOT NULL DEFAULT 5,
    retry_delay_seconds INTEGER NOT NULL DEFAULT 30,

    -- Optional subscription information.
    subscribed_events JSONB NOT NULL DEFAULT '[]'::JSONB,

    -- Safe, non-secret provider-specific settings.
    settings JSONB NOT NULL DEFAULT '{}'::JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_webhook_config_name
        UNIQUE (courier_id, config_name, environment),

    CONSTRAINT chk_webhook_environment
        CHECK (environment IN ('DEVELOPMENT', 'STAGING', 'PRODUCTION')),

    CONSTRAINT chk_webhook_auth_type
        CHECK (auth_type IN ('HMAC_SHA256', 'BEARER_TOKEN', 'NONE')),

    CONSTRAINT chk_webhook_timeout
        CHECK (timeout_seconds BETWEEN 1 AND 120),

    CONSTRAINT chk_webhook_max_retries
        CHECK (max_retries BETWEEN 0 AND 20),

    CONSTRAINT chk_webhook_retry_delay
        CHECK (retry_delay_seconds BETWEEN 1 AND 86400),

    CONSTRAINT chk_webhook_subscribed_events_array
        CHECK (jsonb_typeof(subscribed_events) = 'array'),

    CONSTRAINT chk_webhook_settings_object
        CHECK (jsonb_typeof(settings) = 'object')
);

CREATE INDEX idx_webhook_configurations_courier
    ON webhook_configurations (courier_id);

CREATE INDEX idx_webhook_configurations_enabled
    ON webhook_configurations (courier_id, environment)
    WHERE enabled = TRUE;

COMMIT;