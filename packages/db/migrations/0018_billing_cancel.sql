-- 0018 Self-service cancel (D-030). A cancel from the provider's portal takes effect at the end
-- of the paid period: cancel_at holds that time and the scheduler stops dialing once it passes,
-- even if the provider's final "deleted" event is late or lost.

ALTER TABLE care.subscription ADD COLUMN cancel_at timestamptz;

DROP POLICY start ON care.subscription;
DROP POLICY restart ON care.subscription;
CREATE POLICY start ON care.subscription FOR INSERT TO tomoni_app
  WITH CHECK (household_id = ANY(app.household_ids()) AND status = 'pending' AND subscription_ref IS NULL
              AND customer_ref IS NULL AND current_period_end IS NULL AND cancel_at IS NULL);
CREATE POLICY restart ON care.subscription FOR UPDATE TO tomoni_app
  USING (household_id = ANY(app.household_ids()) AND status IN ('pending','canceled'))
  WITH CHECK (household_id = ANY(app.household_ids()) AND status = 'pending' AND subscription_ref IS NULL
              AND customer_ref IS NULL AND current_period_end IS NULL AND cancel_at IS NULL);

CREATE OR REPLACE VIEW care.callable_patient WITH (security_invoker = true) AS
  SELECT p.id, p.tz, p.locale, p.call_window_start::text AS ws, p.call_window_end::text AS we,
         cc.quiet_start::text AS qs, cc.quiet_end::text AS qe
    FROM care.patient p
    JOIN care.contact_consent cc ON cc.patient_id = p.id AND cc.channel = 'voice' AND cc.withdrawn_at IS NULL
    JOIN care.household h ON h.id = p.household_id
   WHERE p.status = 'active'
     AND (h.region = 'US' OR EXISTS (SELECT 1 FROM care.subscription s
           WHERE s.household_id = h.id AND s.status IN ('active', 'past_due')
             AND (s.cancel_at IS NULL OR s.cancel_at > now())));
