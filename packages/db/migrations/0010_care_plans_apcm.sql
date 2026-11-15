-- 0010 Care plans and APCM month records (Phase 4, BUILD_PROMPT §5.6).
--
-- APCM (HCPCS G0556/G0557/G0558) needs documented consent with the co-pay disclosure (0001),
-- a care plan, and services actually delivered. Tomoni assembles the evidence; the physician
-- signs the plan and the practice bills. Signed plans can never change: a new version
-- supersedes them.

ALTER TABLE care.patient ADD COLUMN qmb boolean NOT NULL DEFAULT false;  -- Qualified Medicare Beneficiary (G0558)

CREATE TABLE care.care_plan (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  patient_id  uuid NOT NULL REFERENCES care.patient(id),
  version     int NOT NULL,
  status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','signed','superseded')),
  body        jsonb NOT NULL,          -- problems, goals, medications, interventions, contacts
  drafted_by  text NOT NULL,           -- 'agent' or a user id
  signed_by   uuid REFERENCES auth.user_account(id),
  signed_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (patient_id, version),
  CHECK ((status = 'draft') = (signed_at IS NULL))
);
CREATE UNIQUE INDEX care_plan_one_signed ON care.care_plan (patient_id) WHERE status = 'signed';

-- Signed plans are immutable; only the move to 'superseded' is allowed, and only a physician of
-- the patient's practice can sign.
CREATE FUNCTION care.care_plan_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, care, auth AS $$
DECLARE ok boolean;
BEGIN
  IF OLD.status <> 'draft' THEN
    IF OLD.status = 'signed' AND NEW.status = 'superseded'
       AND NEW.body = OLD.body AND NEW.signed_by IS NOT DISTINCT FROM OLD.signed_by
       AND NEW.signed_at IS NOT DISTINCT FROM OLD.signed_at AND NEW.version = OLD.version THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'a signed care plan cannot be changed; draft a new version' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'signed' THEN
    SELECT EXISTS (SELECT 1 FROM auth.role_grant g JOIN care.patient p ON p.id = NEW.patient_id
                    WHERE g.user_id = NEW.signed_by AND g.role = 'physician' AND g.revoked_at IS NULL
                      AND g.practice_id = p.practice_id) INTO ok;
    IF NOT ok THEN
      RAISE EXCEPTION 'only a physician of the patient''s practice can sign a care plan' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.body <> OLD.body THEN
      RAISE EXCEPTION 'sign the draft as it is; edit it first, then sign' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard BEFORE UPDATE ON care.care_plan FOR EACH ROW EXECUTE FUNCTION care.care_plan_guard();
REVOKE EXECUTE ON FUNCTION care.care_plan_guard() FROM PUBLIC;

CREATE TABLE care.apcm_month_record (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  patient_id        uuid NOT NULL REFERENCES care.patient(id),
  practice_id       uuid NOT NULL REFERENCES care.practice(id),
  month             date NOT NULL CHECK (extract(day FROM month) = 1),
  hcpcs             text CHECK (hcpcs IN ('G0556','G0557','G0558')),
  chronic_conditions text[] NOT NULL DEFAULT '{}',
  consent_id        uuid REFERENCES care.care_consent(id),
  care_plan_id      uuid REFERENCES care.care_plan(id),
  services          jsonb NOT NULL DEFAULT '[]',   -- [{kind, at, ref}]: only what was delivered
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','billed','excluded')),
  exclusion_reason  text,
  billed_at         timestamptz,
  billed_by         uuid REFERENCES auth.user_account(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (patient_id, month),
  CHECK ((status = 'excluded') = (exclusion_reason IS NOT NULL)),
  CHECK (status NOT IN ('ready','billed') OR (hcpcs IS NOT NULL AND consent_id IS NOT NULL AND care_plan_id IS NOT NULL))
);
CREATE INDEX ON care.apcm_month_record (practice_id, month);
CREATE TRIGGER touch BEFORE UPDATE ON care.apcm_month_record FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
-- A billed month is history.
CREATE FUNCTION care.apcm_billed_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'billed' THEN
    RAISE EXCEPTION 'a billed APCM month cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER billed_guard BEFORE UPDATE ON care.apcm_month_record FOR EACH ROW EXECUTE FUNCTION care.apcm_billed_guard();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['care.care_plan','care.apcm_month_record'] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY worker_all ON %s TO tomoni_worker USING (true) WITH CHECK (true)', t);
    EXECUTE format('CREATE POLICY read ON %s FOR SELECT TO tomoni_app USING (patient_id IN (SELECT id FROM care.patient))', t);
    EXECUTE format('CREATE POLICY staff_insert ON %s FOR INSERT TO tomoni_app WITH CHECK (app.can_write_patient(patient_id))', t);
    EXECUTE format('CREATE POLICY staff_update ON %s FOR UPDATE TO tomoni_app USING (app.can_write_patient(patient_id)) WITH CHECK (app.can_write_patient(patient_id))', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON care.care_plan, care.apcm_month_record TO tomoni_app, tomoni_worker;
