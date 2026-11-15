-- 0013 Research consent and pseudonyms (Phase 5, rule 2.5).
--
-- Care and research are two consents, never mixed. Research consent is its own record, tied to an
-- IRB-approved protocol version, with a HIPAA authorization reference, separate opt-ins for each
-- use, and call-recording permission. research.has_active_consent() is evaluated live by every
-- research policy, so a withdrawal stops data flow on the next statement.

CREATE TABLE research.protocol (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  code              text NOT NULL,
  version           int NOT NULL,
  title             text NOT NULL,
  irb_name          text NOT NULL,
  irb_approval_ref  text,
  approved_at       date,
  expires_at        date,
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','suspended','closed')),
  plain_summary     jsonb NOT NULL,          -- {locale: text} plain-language summary in each language
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, version),
  CHECK (status <> 'approved' OR (irb_approval_ref IS NOT NULL AND approved_at IS NOT NULL AND expires_at IS NOT NULL))
);

-- The pseudonym. Only this table links a research id to a patient; research data carries only
-- research_pid, and the sponsor role can't read this table at all.
CREATE TABLE research.research_id (
  patient_id    uuid PRIMARY KEY REFERENCES care.patient(id),
  research_pid  uuid NOT NULL UNIQUE DEFAULT gen_random_uuid()
);

CREATE TABLE research.research_consent (
  id                       uuid PRIMARY KEY DEFAULT uuidv7(),
  patient_id               uuid NOT NULL REFERENCES care.patient(id),
  protocol_id              uuid NOT NULL REFERENCES research.protocol(id),
  given_by_kind            text NOT NULL CHECK (given_by_kind IN ('patient','representative')),
  given_by_id              uuid REFERENCES care.representative(id),
  hipaa_authorization_ref  text NOT NULL,
  recording_permission     boolean NOT NULL,
  scope_speech_task        boolean NOT NULL,
  scope_trial_matching     boolean NOT NULL,
  scope_pgx_research       boolean NOT NULL,
  method                   text NOT NULL CHECK (method IN ('e_sign','verbal_recorded','written')),
  locale                   text NOT NULL,
  given_at                 timestamptz NOT NULL DEFAULT now(),
  recorded_by              uuid REFERENCES auth.user_account(id),
  withdrawn_at             timestamptz,
  withdrawal_recorded_by   uuid REFERENCES auth.user_account(id),
  CHECK ((given_by_kind = 'representative') = (given_by_id IS NOT NULL)),
  CHECK (scope_speech_task OR scope_trial_matching OR scope_pgx_research)
);
CREATE UNIQUE INDEX research_consent_one_active ON research.research_consent (patient_id, protocol_id) WHERE withdrawn_at IS NULL;

-- Rule 2.5: true only with an active consent, for an approved protocol that has not expired, for
-- that use. No cache: every call reads the rows as they are now.
CREATE FUNCTION research.has_active_consent(pid uuid, scope text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, research AS $$
  SELECT EXISTS (
    SELECT 1 FROM research.research_consent c JOIN research.protocol p ON p.id = c.protocol_id
     WHERE c.patient_id = pid AND c.withdrawn_at IS NULL
       AND p.status = 'approved' AND p.expires_at >= current_date
       AND CASE scope
             WHEN 'speech_task' THEN c.scope_speech_task
             WHEN 'trial_matching' THEN c.scope_trial_matching
             WHEN 'pgx_research' THEN c.scope_pgx_research
             ELSE false
           END)
$$;
-- Withdrawal is immediate and records who recorded it; a consent can't be un-withdrawn.
CREATE FUNCTION research.consent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'a withdrawn consent cannot change; give a new consent instead' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.patient_id, NEW.protocol_id, NEW.given_by_kind, NEW.given_by_id, NEW.hipaa_authorization_ref,
      NEW.recording_permission, NEW.scope_speech_task, NEW.scope_trial_matching, NEW.scope_pgx_research,
      NEW.method, NEW.given_at)
     IS DISTINCT FROM
     (OLD.patient_id, OLD.protocol_id, OLD.given_by_kind, OLD.given_by_id, OLD.hipaa_authorization_ref,
      OLD.recording_permission, OLD.scope_speech_task, OLD.scope_trial_matching, OLD.scope_pgx_research,
      OLD.method, OLD.given_at) THEN
    RAISE EXCEPTION 'a consent is a record: only withdrawal may change it' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard BEFORE UPDATE ON research.research_consent FOR EACH ROW EXECUTE FUNCTION research.consent_guard();

ALTER TABLE research.protocol ENABLE ROW LEVEL SECURITY;
ALTER TABLE research.research_id ENABLE ROW LEVEL SECURITY;
ALTER TABLE research.research_consent ENABLE ROW LEVEL SECURITY;
CREATE POLICY worker_all ON research.protocol TO tomoni_worker USING (true) WITH CHECK (true);
CREATE POLICY worker_all ON research.research_id TO tomoni_worker USING (true) WITH CHECK (true);
CREATE POLICY worker_all ON research.research_consent TO tomoni_worker USING (true) WITH CHECK (true);
-- Protocols are public to signed-in users (families read the plain summary before deciding).
CREATE POLICY read ON research.protocol FOR SELECT TO tomoni_app USING (app.user_id() IS NOT NULL);
-- A consent is visible to whoever can see the patient (so it can be shown and withdrawn).
CREATE POLICY read ON research.research_consent FOR SELECT TO tomoni_app USING (patient_id IN (SELECT id FROM care.patient));
-- Only the patient, or their verified, current legally authorized representative (rule 2.6), gives
-- consent; staff never consent on a patient's behalf and a family member is not a representative
-- by default.
CREATE FUNCTION research.is_my_representative_record(rep uuid, pid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, care, app AS $$
  SELECT EXISTS (SELECT 1 FROM care.representative r JOIN care.family_member fm ON fm.id = r.family_member_id
                  WHERE r.id = rep AND r.patient_id = pid AND fm.user_id = app.user_id()
                    AND r.verified_by IS NOT NULL AND r.valid_from <= current_date
                    AND (r.valid_to IS NULL OR r.valid_to >= current_date))
$$;
GRANT EXECUTE ON FUNCTION research.is_my_representative_record(uuid, uuid) TO tomoni_app;
CREATE POLICY give ON research.research_consent FOR INSERT TO tomoni_app
  WITH CHECK (recorded_by = app.user_id()
              AND ((given_by_kind = 'patient' AND patient_id = ANY(app.patient_ids()))
                   OR (given_by_kind = 'representative' AND research.is_my_representative_record(given_by_id, patient_id))));
CREATE POLICY withdraw ON research.research_consent FOR UPDATE TO tomoni_app
  USING (patient_id IN (SELECT id FROM care.patient)) WITH CHECK (withdrawn_at IS NOT NULL AND withdrawal_recorded_by = app.user_id());
-- The pseudonym map is not readable by request roles at all; the worker uses it.

GRANT USAGE ON SCHEMA research TO tomoni_app, tomoni_worker;
GRANT SELECT ON research.protocol TO tomoni_app;
GRANT SELECT, INSERT, UPDATE ON research.research_consent TO tomoni_app;
GRANT SELECT, INSERT, UPDATE ON research.protocol, research.research_id, research.research_consent TO tomoni_worker;
GRANT EXECUTE ON FUNCTION research.has_active_consent(uuid, text) TO tomoni_app, tomoni_worker;
REVOKE EXECUTE ON FUNCTION research.has_active_consent(uuid, text) FROM PUBLIC;
