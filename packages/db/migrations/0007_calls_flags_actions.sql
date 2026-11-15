-- 0007 Calls, nurse flags, agent actions and approvals (Phase 3, BUILD_PROMPT §5.3–5.4, rules 2.1–2.3, 2.10).

CREATE TABLE care.call (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  patient_id         uuid NOT NULL REFERENCES care.patient(id),
  direction          text NOT NULL DEFAULT 'outbound' CHECK (direction IN ('outbound','inbound')),
  channel            text NOT NULL CHECK (channel IN ('voice','sms','whatsapp','simulator')),
  scheduled_for      timestamptz,
  started_at         timestamptz,
  ended_at           timestamptz,
  locale             text NOT NULL,
  script_version     text NOT NULL,
  prompt_version     text,
  step               text NOT NULL DEFAULT 'scheduled',   -- conversation state machine position
  slots              jsonb NOT NULL DEFAULT '{}',         -- typed answers: medsTaken, mood, …; never free text
  outcome            text CHECK (outcome IN ('completed','no_answer','voicemail','failed','escalated','declined')),
  disclosure_played  boolean NOT NULL DEFAULT false,      -- rule 2.10: no conversation before the AI disclosure
  recording_consent  boolean NOT NULL DEFAULT false,
  transcript         bytea,                               -- enc: JSON array of turns
  summary            bytea,                               -- enc
  care_seconds       int NOT NULL DEFAULT 0,
  research_seconds   int NOT NULL DEFAULT 0,              -- D-009: never counted as APCM care time
  telephony_ref      text,
  idempotency_key    text UNIQUE,                         -- scheduler: patient:date
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (step = 'scheduled' OR disclosure_played OR outcome IN ('no_answer','voicemail','failed'))
);
CREATE INDEX ON care.call (patient_id, created_at DESC);

CREATE TABLE care.nurse_flag (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  patient_id       uuid NOT NULL REFERENCES care.patient(id),
  call_id          uuid REFERENCES care.call(id),
  channel          text NOT NULL CHECK (channel IN ('voice','sms','whatsapp','simulator','family_app')),
  class            text NOT NULL CHECK (class IN ('emergency','symptom','medication_change','self_harm')),
  matched_rule     text NOT NULL,
  excerpt          bytea NOT NULL,                        -- enc: the caller's words
  urgency          int NOT NULL CHECK (urgency BETWEEN 1 AND 3),   -- 1 = now
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  assigned_to      uuid REFERENCES auth.user_account(id),
  acknowledged_at  timestamptz,
  resolved_at      timestamptz,
  resolution_note  bytea,                                 -- enc
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON care.nurse_flag (patient_id) WHERE status <> 'resolved';

CREATE TABLE care.action (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  patient_id        uuid NOT NULL REFERENCES care.patient(id),
  warning_id        uuid REFERENCES care.warning(id),
  skill             text NOT NULL,
  skill_version     int NOT NULL,
  inputs            jsonb NOT NULL,                        -- checked against the skill's schema before insert
  approval_class    text NOT NULL CHECK (approval_class IN ('none','family','physician')),
  state             text NOT NULL DEFAULT 'proposed'
                    CHECK (state IN ('proposed','awaiting_approval','approved','running','verifying','succeeded',
                                     'rejected','failed','handoff','cancelled')),
  confirm_result    jsonb,
  do_result         jsonb,
  verify_result     jsonb,
  attempts          int NOT NULL DEFAULT 0,
  next_attempt_at   timestamptz,
  handoff_reason    text,
  idempotency_key   text NOT NULL UNIQUE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- rule 2.3: nothing reaches "succeeded" without a recorded verification.
  CHECK (state <> 'succeeded' OR verify_result IS NOT NULL)
);
CREATE INDEX ON care.action (patient_id, created_at DESC);
CREATE INDEX ON care.action (state) WHERE state IN ('approved','running','verifying','handoff');

CREATE TABLE care.approval (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  action_id         uuid NOT NULL REFERENCES care.action(id),
  approver_user_id  uuid NOT NULL REFERENCES auth.user_account(id),
  approver_role     text NOT NULL,
  decision          text NOT NULL CHECK (decision IN ('approve','reject')),
  reason            text CHECK (length(reason) <= 500),
  decided_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (action_id)                                       -- one decision per action
);

-- Rule 2.3: the approver must actually hold a role that fits the action's approval class, for that
-- patient. Checked in the database so no API bug can let the wrong person approve.
CREATE FUNCTION care.check_approval() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, care, auth AS $$
DECLARE a care.action; p care.patient; ok boolean;
BEGIN
  SELECT * INTO a FROM care.action WHERE id = NEW.action_id;
  SELECT * INTO p FROM care.patient WHERE id = a.patient_id;
  IF a.state <> 'awaiting_approval' THEN
    RAISE EXCEPTION 'action % is not awaiting approval', a.id USING ERRCODE = 'check_violation';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM auth.role_grant g
     WHERE g.user_id = NEW.approver_user_id AND g.revoked_at IS NULL AND g.role = NEW.approver_role
       AND CASE a.approval_class
             WHEN 'family' THEN (g.role = 'family_member' AND g.household_id = p.household_id)
                             OR (g.role IN ('patient','representative') AND g.patient_id = p.id)
             WHEN 'physician' THEN g.role = 'physician' AND g.practice_id = p.practice_id
             ELSE false
           END) INTO ok;
  IF NOT ok THEN
    RAISE EXCEPTION 'approver role % cannot approve a % action', NEW.approver_role, a.approval_class
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE care.action SET state = CASE NEW.decision WHEN 'approve' THEN 'approved' ELSE 'rejected' END
   WHERE id = a.id;
  RETURN NEW;
END $$;
CREATE TRIGGER check_approval BEFORE INSERT ON care.approval FOR EACH ROW EXECUTE FUNCTION care.check_approval();
REVOKE EXECUTE ON FUNCTION care.check_approval() FROM PUBLIC;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['care.call','care.nurse_flag','care.action'] LOOP
    EXECUTE format('CREATE TRIGGER touch BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()', t);
  END LOOP;
END $$;

-- ─── RLS: the patient policy decides reads ────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['care.call','care.nurse_flag','care.action','care.approval'] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY worker_all ON %s TO tomoni_worker USING (true) WITH CHECK (true)', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['care.call','care.nurse_flag','care.action'] LOOP
    EXECUTE format('CREATE POLICY read ON %s FOR SELECT TO tomoni_app USING (patient_id IN (SELECT id FROM care.patient))', t);
  END LOOP;
END $$;

-- Calls run through the API (simulator, telephony webhooks): staff of the practice may write them.
CREATE POLICY staff_insert ON care.call FOR INSERT TO tomoni_app WITH CHECK (app.can_write_patient(patient_id));
CREATE POLICY staff_update ON care.call FOR UPDATE TO tomoni_app
  USING (app.can_write_patient(patient_id)) WITH CHECK (app.can_write_patient(patient_id));
CREATE POLICY staff_insert ON care.nurse_flag FOR INSERT TO tomoni_app WITH CHECK (app.can_write_patient(patient_id));
-- Nurses acknowledge and resolve flags.
CREATE POLICY staff_update ON care.nurse_flag FOR UPDATE TO tomoni_app
  USING (app.can_write_patient(patient_id)) WITH CHECK (app.can_write_patient(patient_id));
-- Actions are proposed by the system; families and doctors only decide, through care.approval.
CREATE POLICY read ON care.approval FOR SELECT TO tomoni_app
  USING (action_id IN (SELECT id FROM care.action));
CREATE POLICY decide ON care.approval FOR INSERT TO tomoni_app
  WITH CHECK (approver_user_id = app.user_id() AND action_id IN (SELECT id FROM care.action));
-- Ops may hand an action back or cancel it, for practices that allow offshore access (D-008).
CREATE POLICY ops_update ON care.action FOR UPDATE TO tomoni_app
  USING (patient_id IN (SELECT id FROM care.patient) AND (app.is_admin() OR cardinality(app.ops_practice_ids()) > 0))
  WITH CHECK (state IN ('approved','cancelled'));

GRANT SELECT, INSERT, UPDATE ON care.call, care.nurse_flag TO tomoni_app;
GRANT SELECT, UPDATE ON care.action TO tomoni_app;
GRANT SELECT, INSERT ON care.approval TO tomoni_app;
GRANT SELECT, INSERT, UPDATE ON care.call, care.nurse_flag, care.action, care.approval TO tomoni_worker;
