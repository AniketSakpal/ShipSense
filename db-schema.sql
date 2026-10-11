--
-- PostgreSQL database dump
--

-- Dumped from database version 13.4
-- Dumped by pg_dump version 13.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: notification_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.notification_status AS ENUM (
    'PENDING',
    'PROCESSING',
    'SENT',
    'FAILED',
    'DEAD_LETTER',
    'DROPPED'
);


--
-- Name: payment_mode; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_mode AS ENUM (
    'COD',
    'PREPAID'
);


--
-- Name: shipment_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.shipment_status AS ENUM (
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


--
-- Name: webhook_processing_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.webhook_processing_status AS ENUM (
    'RECEIVED',
    'PROCESSING',
    'PROCESSED',
    'FAILED',
    'IGNORED'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: courier_status_code_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.courier_status_code_mappings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    courier_id uuid NOT NULL,
    external_status_code character varying(100) NOT NULL,
    internal_status public.shipment_status NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: couriers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.couriers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code character varying(50) NOT NULL,
    name character varying(150) NOT NULL,
    webhook_enabled boolean DEFAULT true NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ndr_cases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ndr_cases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shipment_id uuid NOT NULL,
    awb character varying(100) NOT NULL,
    attempt_no integer NOT NULL,
    failure_reason character varying(40) NOT NULL,
    payment_mode character varying(20) NOT NULL,
    cod_amount_paise bigint DEFAULT 0 NOT NULL,
    status character varying(30) DEFAULT 'OPEN'::character varying NOT NULL,
    recommended_action character varying(40) NOT NULL,
    decision_explanation text NOT NULL,
    decision_metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    response_deadline_at timestamp with time zone NOT NULL,
    customer_response character varying(40),
    customer_response_at timestamp with time zone,
    escalated_at timestamp with time zone,
    closed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_ndr_action CHECK (((recommended_action)::text = ANY ((ARRAY['CONTACT_CUSTOMER'::character varying, 'RETRY_DELIVERY'::character varying, 'ESCALATE'::character varying, 'INITIATE_RTO'::character varying])::text[]))),
    CONSTRAINT chk_ndr_attempt CHECK ((attempt_no > 0)),
    CONSTRAINT chk_ndr_cod_amount CHECK ((cod_amount_paise >= 0)),
    CONSTRAINT chk_ndr_failure_reason CHECK (((failure_reason)::text = ANY ((ARRAY['CUSTOMER_UNAVAILABLE'::character varying, 'ADDRESS_ISSUE'::character varying, 'REFUSED'::character varying, 'COD_NOT_READY'::character varying, 'PREMISES_CLOSED'::character varying, 'OTHER'::character varying])::text[]))),
    CONSTRAINT chk_ndr_payment_mode CHECK (((payment_mode)::text = ANY ((ARRAY['COD'::character varying, 'PREPAID'::character varying])::text[]))),
    CONSTRAINT chk_ndr_response CHECK (((customer_response IS NULL) OR ((customer_response)::text = ANY ((ARRAY['RETRY_DELIVERY'::character varying, 'UPDATE_ADDRESS'::character varying, 'CANCEL_DELIVERY'::character varying])::text[])))),
    CONSTRAINT chk_ndr_status CHECK (((status)::text = ANY ((ARRAY['OPEN'::character varying, 'AWAITING_CUSTOMER'::character varying, 'RETRY_REQUESTED'::character varying, 'ESCALATED'::character varying, 'RTO_PENDING'::character varying, 'RTO_INITIATED'::character varying, 'CLOSED'::character varying])::text[])))
);


--
-- Name: ndr_courier_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ndr_courier_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ndr_case_id uuid NOT NULL,
    action_type character varying(40) NOT NULL,
    idempotency_key character varying(200) NOT NULL,
    status character varying(20) DEFAULT 'PENDING'::character varying NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    next_retry_at timestamp with time zone DEFAULT now(),
    request_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    response_payload jsonb,
    last_error text,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_ndr_courier_action_attempts CHECK ((attempts >= 0)),
    CONSTRAINT chk_ndr_courier_action_status CHECK (((status)::text = ANY ((ARRAY['PENDING'::character varying, 'PROCESSING'::character varying, 'SUCCEEDED'::character varying, 'FAILED'::character varying, 'DEAD_LETTER'::character varying])::text[]))),
    CONSTRAINT chk_ndr_courier_action_type CHECK (((action_type)::text = ANY ((ARRAY['RETRY_DELIVERY'::character varying, 'INITIATE_RTO'::character varying])::text[])))
);


--
-- Name: ndr_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ndr_rules (
    id bigint NOT NULL,
    rule_key character varying(80) NOT NULL,
    description text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    priority integer DEFAULT 100 NOT NULL,
    conditions jsonb DEFAULT '{}'::jsonb NOT NULL,
    action character varying(40) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_ndr_rule_action CHECK (((action)::text = ANY ((ARRAY['CONTACT_CUSTOMER'::character varying, 'RETRY_DELIVERY'::character varying, 'ESCALATE'::character varying, 'INITIATE_RTO'::character varying])::text[])))
);


--
-- Name: ndr_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ndr_rules_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ndr_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ndr_rules_id_seq OWNED BY public.ndr_rules.id;


--
-- Name: notification_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_outbox (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shipment_id uuid NOT NULL,
    shipment_event_id uuid NOT NULL,
    notification_type character varying(100) NOT NULL,
    recipient character varying(255) NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    status public.notification_status DEFAULT 'PENDING'::public.notification_status NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    next_retry_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    last_error text,
    attempt_no integer DEFAULT 0 NOT NULL,
    channel character varying(16) DEFAULT 'WHATSAPP'::character varying NOT NULL,
    whatsapp_attempts integer DEFAULT 0 NOT NULL,
    sms_attempts integer DEFAULT 0 NOT NULL,
    available_at timestamp with time zone DEFAULT now() NOT NULL,
    locked_at timestamp with time zone,
    locked_by character varying(128),
    lock_token uuid,
    idempotency_key character varying(128),
    provider_message_id character varying(256),
    dead_lettered_at timestamp with time zone,
    dropped_at timestamp with time zone,
    drop_reason character varying(256),
    replay_count integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_notification_attempt_no CHECK ((attempt_no >= 0)),
    CONSTRAINT chk_notification_attempts CHECK ((attempts >= 0)),
    CONSTRAINT chk_notification_channel CHECK (((channel)::text = ANY ((ARRAY['WHATSAPP'::character varying, 'SMS'::character varying])::text[]))),
    CONSTRAINT chk_notification_replay_count CHECK ((replay_count >= 0)),
    CONSTRAINT chk_notification_sms_attempts CHECK ((sms_attempts >= 0)),
    CONSTRAINT chk_notification_whatsapp_attempts CHECK ((whatsapp_attempts >= 0))
);


--
-- Name: shipment_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipment_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shipment_id uuid NOT NULL,
    courier_id uuid NOT NULL,
    webhook_event_id uuid NOT NULL,
    dedup_key character varying(300) NOT NULL,
    external_event_id character varying(200),
    status public.shipment_status NOT NULL,
    event_time timestamp with time zone NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    location text,
    description text,
    state_changed boolean DEFAULT false NOT NULL,
    decision_reason character varying(100) NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: shipment_status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipment_status_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shipment_id uuid NOT NULL,
    shipment_event_id uuid NOT NULL,
    previous_status public.shipment_status,
    new_status public.shipment_status NOT NULL,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_status_history_changed CHECK (((previous_status IS NULL) OR (previous_status <> new_status)))
);


--
-- Name: shipments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    courier_id uuid NOT NULL,
    awb character varying(120) NOT NULL,
    order_ref character varying(150) NOT NULL,
    customer_ref character varying(150) NOT NULL,
    customer_phone character varying(30) NOT NULL,
    payment_mode public.payment_mode NOT NULL,
    cod_amount_paise bigint DEFAULT 0 NOT NULL,
    current_status public.shipment_status DEFAULT 'CREATED'::public.shipment_status NOT NULL,
    last_status_event_id uuid,
    registered_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_cod_amount_nonnegative CHECK ((cod_amount_paise >= 0)),
    CONSTRAINT chk_prepaid_cod_amount CHECK (((payment_mode <> 'PREPAID'::public.payment_mode) OR (cod_amount_paise = 0)))
);


--
-- Name: webhook_configurations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_configurations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    courier_id uuid NOT NULL,
    config_name character varying(100) NOT NULL,
    environment character varying(20) DEFAULT 'PRODUCTION'::character varying NOT NULL,
    endpoint_path character varying(255) NOT NULL,
    auth_type character varying(30) DEFAULT 'HMAC_SHA256'::character varying NOT NULL,
    secret_reference text,
    allowed_source_ips inet[] DEFAULT '{}'::inet[] NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    timeout_seconds integer DEFAULT 10 NOT NULL,
    max_retries integer DEFAULT 5 NOT NULL,
    retry_delay_seconds integer DEFAULT 30 NOT NULL,
    subscribed_events jsonb DEFAULT '[]'::jsonb NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_webhook_auth_type CHECK (((auth_type)::text = ANY ((ARRAY['HMAC_SHA256'::character varying, 'BEARER_TOKEN'::character varying, 'NONE'::character varying])::text[]))),
    CONSTRAINT chk_webhook_environment CHECK (((environment)::text = ANY ((ARRAY['DEVELOPMENT'::character varying, 'STAGING'::character varying, 'PRODUCTION'::character varying])::text[]))),
    CONSTRAINT chk_webhook_max_retries CHECK (((max_retries >= 0) AND (max_retries <= 20))),
    CONSTRAINT chk_webhook_retry_delay CHECK (((retry_delay_seconds >= 1) AND (retry_delay_seconds <= 86400))),
    CONSTRAINT chk_webhook_settings_object CHECK ((jsonb_typeof(settings) = 'object'::text)),
    CONSTRAINT chk_webhook_subscribed_events_array CHECK ((jsonb_typeof(subscribed_events) = 'array'::text)),
    CONSTRAINT chk_webhook_timeout CHECK (((timeout_seconds >= 1) AND (timeout_seconds <= 120)))
);


--
-- Name: webhook_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    webhook_event_id uuid NOT NULL,
    attempt_number integer NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    succeeded boolean DEFAULT false NOT NULL,
    error_message text,
    CONSTRAINT chk_webhook_attempt_number CHECK ((attempt_number > 0)),
    CONSTRAINT chk_webhook_attempt_time CHECK (((finished_at IS NULL) OR (finished_at >= started_at)))
);


--
-- Name: webhook_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    courier_id uuid NOT NULL,
    external_event_id character varying(200),
    raw_body bytea NOT NULL,
    payload jsonb NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    signature_valid boolean DEFAULT false NOT NULL,
    processing_status public.webhook_processing_status DEFAULT 'RECEIVED'::public.webhook_processing_status NOT NULL,
    processing_attempts integer DEFAULT 0 NOT NULL,
    next_retry_at timestamp with time zone,
    processed_at timestamp with time zone,
    last_error text,
    dedup_key character varying(300),
    CONSTRAINT chk_webhook_attempts CHECK ((processing_attempts >= 0))
);


--
-- Name: ndr_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ndr_rules ALTER COLUMN id SET DEFAULT nextval('public.ndr_rules_id_seq'::regclass);


--
-- Name: courier_status_code_mappings courier_status_code_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courier_status_code_mappings
    ADD CONSTRAINT courier_status_code_mappings_pkey PRIMARY KEY (id);


--
-- Name: couriers couriers_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.couriers
    ADD CONSTRAINT couriers_code_key UNIQUE (code);


--
-- Name: couriers couriers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.couriers
    ADD CONSTRAINT couriers_pkey PRIMARY KEY (id);


--
-- Name: ndr_cases ndr_cases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ndr_cases
    ADD CONSTRAINT ndr_cases_pkey PRIMARY KEY (id);


--
-- Name: ndr_courier_actions ndr_courier_actions_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ndr_courier_actions
    ADD CONSTRAINT ndr_courier_actions_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: ndr_courier_actions ndr_courier_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ndr_courier_actions
    ADD CONSTRAINT ndr_courier_actions_pkey PRIMARY KEY (id);


--
-- Name: ndr_rules ndr_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ndr_rules
    ADD CONSTRAINT ndr_rules_pkey PRIMARY KEY (id);


--
-- Name: ndr_rules ndr_rules_rule_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ndr_rules
    ADD CONSTRAINT ndr_rules_rule_key_key UNIQUE (rule_key);


--
-- Name: notification_outbox notification_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_outbox
    ADD CONSTRAINT notification_outbox_pkey PRIMARY KEY (id);


--
-- Name: shipment_events shipment_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_events
    ADD CONSTRAINT shipment_events_pkey PRIMARY KEY (id);


--
-- Name: shipment_status_history shipment_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_status_history
    ADD CONSTRAINT shipment_status_history_pkey PRIMARY KEY (id);


--
-- Name: shipments shipments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT shipments_pkey PRIMARY KEY (id);


--
-- Name: shipments uq_courier_awb; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT uq_courier_awb UNIQUE (courier_id, awb);


--
-- Name: courier_status_code_mappings uq_courier_external_status; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courier_status_code_mappings
    ADD CONSTRAINT uq_courier_external_status UNIQUE (courier_id, external_status_code);


--
-- Name: ndr_cases uq_ndr_awb_attempt; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ndr_cases
    ADD CONSTRAINT uq_ndr_awb_attempt UNIQUE (awb, attempt_no);


--
-- Name: notification_outbox uq_notification_intent; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_outbox
    ADD CONSTRAINT uq_notification_intent UNIQUE (shipment_event_id, notification_type, recipient);


--
-- Name: shipment_events uq_shipment_event_dedup; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_events
    ADD CONSTRAINT uq_shipment_event_dedup UNIQUE (courier_id, dedup_key);


--
-- Name: shipment_events uq_shipment_event_webhook; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_events
    ADD CONSTRAINT uq_shipment_event_webhook UNIQUE (webhook_event_id, dedup_key);


--
-- Name: shipment_status_history uq_status_history_event; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_status_history
    ADD CONSTRAINT uq_status_history_event UNIQUE (shipment_event_id);


--
-- Name: webhook_deliveries uq_webhook_attempt; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_deliveries
    ADD CONSTRAINT uq_webhook_attempt UNIQUE (webhook_event_id, attempt_number);


--
-- Name: webhook_configurations uq_webhook_config_name; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_configurations
    ADD CONSTRAINT uq_webhook_config_name UNIQUE (courier_id, config_name, environment);


--
-- Name: webhook_configurations webhook_configurations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_configurations
    ADD CONSTRAINT webhook_configurations_pkey PRIMARY KEY (id);


--
-- Name: webhook_deliveries webhook_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_deliveries
    ADD CONSTRAINT webhook_deliveries_pkey PRIMARY KEY (id);


--
-- Name: webhook_events webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_pkey PRIMARY KEY (id);


--
-- Name: idx_ndr_cases_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ndr_cases_due ON public.ndr_cases USING btree (response_deadline_at) WHERE ((status)::text = ANY ((ARRAY['OPEN'::character varying, 'AWAITING_CUSTOMER'::character varying])::text[]));


--
-- Name: idx_ndr_cases_shipment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ndr_cases_shipment ON public.ndr_cases USING btree (shipment_id, attempt_no DESC);


--
-- Name: idx_ndr_courier_actions_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ndr_courier_actions_pending ON public.ndr_courier_actions USING btree (next_retry_at, created_at) WHERE ((status)::text = ANY ((ARRAY['PENDING'::character varying, 'FAILED'::character varying])::text[]));


--
-- Name: idx_notification_outbox_dead_letter; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_outbox_dead_letter ON public.notification_outbox USING btree (dead_lettered_at DESC) WHERE (status = 'DEAD_LETTER'::public.notification_status);


--
-- Name: idx_notification_outbox_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_outbox_pending ON public.notification_outbox USING btree (available_at, created_at, id) WHERE (status = 'PENDING'::public.notification_status);


--
-- Name: idx_notification_outbox_processing; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_outbox_processing ON public.notification_outbox USING btree (locked_at) WHERE (status = 'PROCESSING'::public.notification_status);


--
-- Name: idx_notification_outbox_retry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_outbox_retry ON public.notification_outbox USING btree (next_retry_at) WHERE (status = 'FAILED'::public.notification_status);


--
-- Name: idx_notification_outbox_shipment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_outbox_shipment ON public.notification_outbox USING btree (shipment_id, created_at DESC);


--
-- Name: idx_shipment_events_courier_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shipment_events_courier_time ON public.shipment_events USING btree (courier_id, event_time DESC);


--
-- Name: idx_shipment_events_status_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shipment_events_status_time ON public.shipment_events USING btree (status, event_time DESC);


--
-- Name: idx_shipment_events_timeline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shipment_events_timeline ON public.shipment_events USING btree (shipment_id, event_time, id);


--
-- Name: idx_shipment_events_webhook; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shipment_events_webhook ON public.shipment_events USING btree (webhook_event_id);


--
-- Name: idx_shipments_courier_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shipments_courier_status ON public.shipments USING btree (courier_id, current_status);


--
-- Name: idx_shipments_customer_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shipments_customer_ref ON public.shipments USING btree (customer_ref);


--
-- Name: idx_shipments_order_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shipments_order_ref ON public.shipments USING btree (order_ref);


--
-- Name: idx_shipments_registered_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shipments_registered_at ON public.shipments USING btree (registered_at DESC);


--
-- Name: idx_shipments_status_registered; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shipments_status_registered ON public.shipments USING btree (current_status, registered_at DESC);


--
-- Name: idx_status_history_new_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_status_history_new_status ON public.shipment_status_history USING btree (new_status, changed_at DESC);


--
-- Name: idx_status_history_timeline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_status_history_timeline ON public.shipment_status_history USING btree (shipment_id, changed_at, id);


--
-- Name: idx_webhook_configurations_courier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_configurations_courier ON public.webhook_configurations USING btree (courier_id);


--
-- Name: idx_webhook_configurations_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_configurations_enabled ON public.webhook_configurations USING btree (courier_id, environment) WHERE (enabled = true);


--
-- Name: idx_webhook_deliveries_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_deliveries_event ON public.webhook_deliveries USING btree (webhook_event_id, attempt_number DESC);


--
-- Name: idx_webhook_events_courier_received; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_events_courier_received ON public.webhook_events USING btree (courier_id, received_at DESC);


--
-- Name: idx_webhook_events_external_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_events_external_id ON public.webhook_events USING btree (courier_id, external_event_id) WHERE (external_event_id IS NOT NULL);


--
-- Name: idx_webhook_events_payload_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_events_payload_gin ON public.webhook_events USING gin (payload);


--
-- Name: idx_webhook_events_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_events_pending ON public.webhook_events USING btree (received_at) WHERE (processing_status = ANY (ARRAY['RECEIVED'::public.webhook_processing_status, 'FAILED'::public.webhook_processing_status]));


--
-- Name: idx_webhook_events_retry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_events_retry ON public.webhook_events USING btree (next_retry_at, received_at) WHERE (processing_status = ANY (ARRAY['RECEIVED'::public.webhook_processing_status, 'FAILED'::public.webhook_processing_status]));


--
-- Name: uq_notification_shipment_type_attempt; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_notification_shipment_type_attempt ON public.notification_outbox USING btree (shipment_id, notification_type, attempt_no);


--
-- Name: uq_webhook_events_courier_dedup; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_webhook_events_courier_dedup ON public.webhook_events USING btree (courier_id, dedup_key) WHERE (dedup_key IS NOT NULL);


--
-- Name: courier_status_code_mappings courier_status_code_mappings_courier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courier_status_code_mappings
    ADD CONSTRAINT courier_status_code_mappings_courier_id_fkey FOREIGN KEY (courier_id) REFERENCES public.couriers(id) ON DELETE RESTRICT;


--
-- Name: shipments fk_shipments_last_status_event; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT fk_shipments_last_status_event FOREIGN KEY (last_status_event_id) REFERENCES public.shipment_events(id) ON DELETE RESTRICT;


--
-- Name: ndr_cases ndr_cases_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ndr_cases
    ADD CONSTRAINT ndr_cases_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.shipments(id);


--
-- Name: ndr_courier_actions ndr_courier_actions_ndr_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ndr_courier_actions
    ADD CONSTRAINT ndr_courier_actions_ndr_case_id_fkey FOREIGN KEY (ndr_case_id) REFERENCES public.ndr_cases(id);


--
-- Name: notification_outbox notification_outbox_shipment_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_outbox
    ADD CONSTRAINT notification_outbox_shipment_event_id_fkey FOREIGN KEY (shipment_event_id) REFERENCES public.shipment_events(id) ON DELETE RESTRICT;


--
-- Name: notification_outbox notification_outbox_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_outbox
    ADD CONSTRAINT notification_outbox_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE RESTRICT;


--
-- Name: shipment_events shipment_events_courier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_events
    ADD CONSTRAINT shipment_events_courier_id_fkey FOREIGN KEY (courier_id) REFERENCES public.couriers(id) ON DELETE RESTRICT;


--
-- Name: shipment_events shipment_events_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_events
    ADD CONSTRAINT shipment_events_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE RESTRICT;


--
-- Name: shipment_events shipment_events_webhook_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_events
    ADD CONSTRAINT shipment_events_webhook_event_id_fkey FOREIGN KEY (webhook_event_id) REFERENCES public.webhook_events(id) ON DELETE RESTRICT;


--
-- Name: shipment_status_history shipment_status_history_shipment_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_status_history
    ADD CONSTRAINT shipment_status_history_shipment_event_id_fkey FOREIGN KEY (shipment_event_id) REFERENCES public.shipment_events(id) ON DELETE RESTRICT;


--
-- Name: shipment_status_history shipment_status_history_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_status_history
    ADD CONSTRAINT shipment_status_history_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE RESTRICT;


--
-- Name: shipments shipments_courier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT shipments_courier_id_fkey FOREIGN KEY (courier_id) REFERENCES public.couriers(id) ON DELETE RESTRICT;


--
-- Name: webhook_configurations webhook_configurations_courier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_configurations
    ADD CONSTRAINT webhook_configurations_courier_id_fkey FOREIGN KEY (courier_id) REFERENCES public.couriers(id) ON DELETE RESTRICT;


--
-- Name: webhook_deliveries webhook_deliveries_webhook_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_deliveries
    ADD CONSTRAINT webhook_deliveries_webhook_event_id_fkey FOREIGN KEY (webhook_event_id) REFERENCES public.webhook_events(id) ON DELETE RESTRICT;


--
-- Name: webhook_events webhook_events_courier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_courier_id_fkey FOREIGN KEY (courier_id) REFERENCES public.couriers(id) ON DELETE RESTRICT;


--
-- PostgreSQL database dump complete
--

