-- ShipSense reference-data seed
-- No UUIDs are hardcoded. Courier IDs are resolved by courier code.
-- Assumptions:
--   1. public.couriers has a UNIQUE constraint on code.
--   2. public.courier_status_code_mappings has columns shown below.
--   3. PostgreSQL supports gen_random_uuid() (available in PostgreSQL 13).
--
-- This script is safe to re-run sequentially: existing couriers are updated by
-- code, and existing mappings are updated by (courier_id, external_status_code).
-- The mapping upsert assumes a UNIQUE constraint on that column pair.

BEGIN;

WITH courier_seed(code, name, webhook_enabled, is_active) AS (
    VALUES
        ('SWIFTSHIP', 'SwiftShip', TRUE, TRUE),
        ('BLUEROUTE', 'BlueRoute', TRUE, TRUE)
)
INSERT INTO public.couriers (id, code, name, webhook_enabled, is_active)
SELECT gen_random_uuid(), code, name, webhook_enabled, is_active
FROM courier_seed
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    webhook_enabled = EXCLUDED.webhook_enabled,
    is_active = EXCLUDED.is_active,
    updated_at = CURRENT_TIMESTAMP;

WITH mapping_seed(courier_code, external_status_code, internal_status, description, is_active) AS (
    VALUES
        ('SWIFTSHIP', 'LST', 'LOST', 'Shipment lost', TRUE),
        ('SWIFTSHIP', 'RTD', 'RTO_DELIVERED', 'Returned to origin', TRUE),
        ('SWIFTSHIP', 'RTI', 'RTO_INITIATED', 'Return to origin initiated', TRUE),
        ('SWIFTSHIP', 'DLV', 'DELIVERED', 'Shipment delivered', TRUE),
        ('SWIFTSHIP', 'UDL', 'DELIVERY_FAILED', 'Delivery unsuccessful', TRUE),
        ('SWIFTSHIP', 'OFD', 'OUT_FOR_DELIVERY', 'Out for delivery', TRUE),
        ('SWIFTSHIP', 'IT',  'IN_TRANSIT', 'Shipment in transit', TRUE),
        ('SWIFTSHIP', 'PKD', 'PICKED_UP', 'Shipment picked up', TRUE),

        ('BLUEROUTE', '90', 'LOST', 'Shipment lost', TRUE),
        ('BLUEROUTE', '55', 'RTO_DELIVERED', 'Returned to origin', TRUE),
        ('BLUEROUTE', '50', 'RTO_INITIATED', 'Return to origin initiated', TRUE),
        ('BLUEROUTE', '40', 'DELIVERED', 'Shipment delivered', TRUE),
        ('BLUEROUTE', '35', 'DELIVERY_FAILED', 'Delivery unsuccessful', TRUE),
        ('BLUEROUTE', '34', 'OUT_FOR_DELIVERY', 'Out for delivery', TRUE),
        ('BLUEROUTE', '30', 'IN_TRANSIT', 'Shipment in transit', TRUE),
        ('BLUEROUTE', '20', 'PICKED_UP', 'Shipment picked up', TRUE)
)
INSERT INTO public.courier_status_code_mappings
    (id, courier_id, external_status_code, internal_status, description, is_active)
SELECT
    gen_random_uuid(),
    c.id,
    m.external_status_code,
    m.internal_status::public.shipment_status,
    m.description,
    m.is_active
FROM mapping_seed m
JOIN public.couriers c
    ON c.code = m.courier_code
ON CONFLICT (courier_id, external_status_code) DO UPDATE
SET internal_status = EXCLUDED.internal_status,
    description = EXCLUDED.description,
    is_active = EXCLUDED.is_active;

COMMIT;
