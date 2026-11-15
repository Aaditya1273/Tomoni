-- 0017 Family subscription (Phase 4b, D-030). In India there is no APCM: the family abroad pays
-- for the parent's daily call. The family can only *start* a checkout; only a verified payment
-- webhook (worker role) can make a subscription active. RLS enforces that split.

CREATE TABLE care.subscription (
  household_id       uuid PRIMARY KEY REFERENCES care.household(id),
  plan_code          text NOT NULL CHECK (plan_code IN ('family_daily_v1')),
  status             text NOT NULL CHECK (status IN ('pending','active','past_due','canceled')),
  provider           text NOT NULL CHECK (provider IN ('stripe','mock')),
  checkout_ref       text,
  customer_ref       text,
  subscription_ref   text UNIQUE,
  current_period_end timestamptz,
  started_by         uuid REFERENCES auth.user_account(id),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Webhook idempotency: each provider event is applied once.
CREATE TABLE care.billing_event (
  provider     text NOT NULL,
  event_id     text NOT NULL,
  kind         text NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, event_id)
);

ALTER TABLE care.subscription ENABLE ROW LEVEL SECURITY;
ALTER TABLE care.billing_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY worker_all ON care.subscription TO tomoni_worker USING (true) WITH CHECK (true);
CREATE POLICY worker_all ON care.billing_event TO tomoni_worker USING (true) WITH CHECK (true);
CREATE POLICY read ON care.subscription FOR SELECT TO tomoni_app
  USING (app.is_admin() OR household_id = ANY(app.household_ids()));
-- The family may open or reopen a checkout for its own household, and nothing else: never
-- 'active', never someone else's household, never a provider subscription id or paid period.
CREATE POLICY start ON care.subscription FOR INSERT TO tomoni_app
  WITH CHECK (household_id = ANY(app.household_ids()) AND
              status = 'pending' AND subscription_ref IS NULL AND customer_ref IS NULL AND current_period_end IS NULL);
CREATE POLICY restart ON care.subscription FOR UPDATE TO tomoni_app
  USING (household_id = ANY(app.household_ids()) AND status IN ('pending','canceled'))
  WITH CHECK (household_id = ANY(app.household_ids()) AND
              status = 'pending' AND subscription_ref IS NULL AND customer_ref IS NULL AND current_period_end IS NULL);

GRANT SELECT, INSERT, UPDATE ON care.subscription TO tomoni_app;
GRANT SELECT, INSERT, UPDATE ON care.subscription, care.billing_event TO tomoni_worker;

-- Who the daily-call scheduler may dial: active, with voice consent, and either a US household
-- (the practice pays, APCM) or an India household with a live family plan. Past-due keeps
-- calling through the provider's retry window: one failed card never silences a daily check-in.
CREATE VIEW care.callable_patient WITH (security_invoker = true) AS
  SELECT p.id, p.tz, p.locale, p.call_window_start::text AS ws, p.call_window_end::text AS we,
         cc.quiet_start::text AS qs, cc.quiet_end::text AS qe
    FROM care.patient p
    JOIN care.contact_consent cc ON cc.patient_id = p.id AND cc.channel = 'voice' AND cc.withdrawn_at IS NULL
    JOIN care.household h ON h.id = p.household_id
   WHERE p.status = 'active'
     AND (h.region = 'US' OR EXISTS (SELECT 1 FROM care.subscription s
           WHERE s.household_id = h.id AND s.status IN ('active', 'past_due')));
GRANT SELECT ON care.callable_patient TO tomoni_worker;
