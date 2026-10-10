-- Ensure a shipment ID and courier ID form a referenced key.
ALTER TABLE shipments
    ADD CONSTRAINT uq_shipments_id_courier
    UNIQUE (id, courier_id);

-- Ensure a webhook ID and courier ID form a referenced key.
ALTER TABLE webhook_events
    ADD CONSTRAINT uq_webhook_events_id_courier
    UNIQUE (id, courier_id);

-- Enforce that the event's courier owns the shipment.
ALTER TABLE shipment_events
    ADD CONSTRAINT fk_event_shipment_courier
    FOREIGN KEY (shipment_id, courier_id)
    REFERENCES shipments (id, courier_id)
    ON DELETE RESTRICT;

-- Enforce that the event references a webhook from the same courier.
ALTER TABLE shipment_events
    ADD CONSTRAINT fk_event_webhook_courier
    FOREIGN KEY (webhook_event_id, courier_id)
    REFERENCES webhook_events (id, courier_id)
    ON DELETE RESTRICT;