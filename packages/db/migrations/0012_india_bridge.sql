-- 0012 India bridge (STRATEGY.md, D-027): households have a region; outside the US there is no
-- Medicare and no Blue Button, so families enter medicines themselves, with a photo of the
-- prescription or bill kept as evidence.
ALTER TABLE care.household ADD COLUMN region text NOT NULL DEFAULT 'US' CHECK (region IN ('US','IN'));

ALTER TABLE care.patient DROP CONSTRAINT patient_medicare_type_check;
ALTER TABLE care.patient ADD CONSTRAINT patient_medicare_type_check CHECK (medicare_type IN ('original','advantage','none'));

-- Family-entered fills have no NDC; they name the medicine through care.medication.
ALTER TABLE care.fill ALTER COLUMN ndc DROP NOT NULL;
ALTER TABLE care.fill ADD COLUMN evidence_ref text;          -- object-store key of the prescription photo
ALTER TABLE care.fill ADD CONSTRAINT fill_names_a_drug CHECK (ndc IS NOT NULL OR medication_id IS NOT NULL);

-- Families may add medicines and fills for their own household, marked as theirs, and only for
-- regions without claims data. Staff and the worker keep their existing rights.
CREATE FUNCTION app.can_family_enter(pid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM care.patient p JOIN care.household h ON h.id = p.household_id
                  WHERE p.id = pid AND h.region <> 'US'
                    AND (p.household_id = ANY(app.household_ids()) OR p.id = ANY(app.patient_ids())))
$$;
GRANT EXECUTE ON FUNCTION app.can_family_enter(uuid) TO tomoni_app, tomoni_worker;
CREATE POLICY family_insert ON care.medication FOR INSERT TO tomoni_app
  WITH CHECK (source = 'family' AND app.can_family_enter(patient_id));
CREATE POLICY family_update ON care.medication FOR UPDATE TO tomoni_app
  USING (source = 'family' AND app.can_family_enter(patient_id)) WITH CHECK (source = 'family' AND app.can_family_enter(patient_id));
CREATE POLICY family_insert ON care.fill FOR INSERT TO tomoni_app
  WITH CHECK (source = 'manual' AND app.can_family_enter(patient_id));
