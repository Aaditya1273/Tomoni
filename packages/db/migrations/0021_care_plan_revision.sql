-- 0021 Inline care-plan edits. Each edit of a draft bumps its revision, and signing names the
-- revision the physician saw: a nurse's edit a second earlier can't be signed unseen.
ALTER TABLE care.care_plan ADD COLUMN revision int NOT NULL DEFAULT 0 CHECK (revision >= 0);

CREATE OR REPLACE FUNCTION care.care_plan_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, care, auth AS $$
DECLARE ok boolean;
BEGIN
  IF OLD.status <> 'draft' THEN
    IF OLD.status = 'signed' AND NEW.status = 'superseded'
       AND NEW.body = OLD.body AND NEW.revision = OLD.revision AND NEW.signed_by IS NOT DISTINCT FROM OLD.signed_by
       AND NEW.signed_at IS NOT DISTINCT FROM OLD.signed_at AND NEW.version = OLD.version THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'a signed care plan cannot be changed; draft a new version' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'draft' AND NEW.body <> OLD.body AND NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'an edit bumps the revision by one' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'signed' THEN
    SELECT EXISTS (SELECT 1 FROM auth.role_grant g JOIN care.patient p ON p.id = NEW.patient_id
                    WHERE g.user_id = NEW.signed_by AND g.role = 'physician' AND g.revoked_at IS NULL
                      AND g.practice_id = p.practice_id) INTO ok;
    IF NOT ok THEN
      RAISE EXCEPTION 'only a physician of the patient''s practice can sign a care plan' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.body <> OLD.body OR NEW.revision <> OLD.revision THEN
      RAISE EXCEPTION 'sign the draft as it is; edit it first, then sign' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
