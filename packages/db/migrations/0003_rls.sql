-- 0003 Row-level security and grants (SECURITY S1).
--
-- tomoni_app    = API requests. Sees only what the request scope allows.
-- tomoni_worker = background jobs. Trusted system actor in `care` (research gating still applies in Phase 5).
-- tomoni_sponsor = sponsor API. No access to any table, ever.
--
-- Child tables reuse the patient policy by filtering on `patient_id IN (SELECT id FROM care.patient)`:
-- that subquery runs with the caller's RLS, so there is exactly one place that decides who sees a patient.

-- Practices of the patients a family member / patient / representative can see. SECURITY DEFINER so the
-- practice policy does not recurse through the patient policy.
CREATE FUNCTION app.my_patient_practice_ids() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, care, app AS $$
  SELECT coalesce(array_agg(DISTINCT practice_id), '{}') FROM care.patient
   WHERE household_id = ANY(app.household_ids()) OR id = ANY(app.patient_ids())
$$;

CREATE FUNCTION app.can_write_patient(pid uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_admin() OR EXISTS (
    SELECT 1 FROM care.patient p WHERE p.id = pid AND p.practice_id = ANY(app.staff_practice_ids()))
$$;

-- ─── Enable RLS everywhere ─────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['auth.user_account','auth.identity','auth.role_grant','auth.session',
                           'care.practice','care.clinician','care.household','care.patient',
                           'care.family_member','care.representative','care.care_consent',
                           'care.contact_consent','care.outbox','audit.event'] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY worker_all ON %s TO tomoni_worker USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- The migration owner (table owner) is not bound by RLS; SECURITY DEFINER functions rely on that.
-- No request ever connects as the owner (RUNBOOK).

-- ─── auth: a user sees only their own rows; everything else goes through auth.* functions ──
CREATE POLICY own ON auth.user_account FOR SELECT TO tomoni_app USING (id = app.user_id() OR app.is_admin());
CREATE POLICY own ON auth.role_grant  FOR SELECT TO tomoni_app USING (user_id = app.user_id() OR app.is_admin());

-- ─── care.practice (not PHI, but tenants should not list each other) ───────────
CREATE POLICY read ON care.practice FOR SELECT TO tomoni_app USING (
  app.is_admin()
  OR id = ANY(app.staff_practice_ids())
  OR id = ANY(app.ops_practice_ids())
  OR id = ANY(app.my_patient_practice_ids()));
CREATE POLICY admin_write ON care.practice FOR ALL TO tomoni_app USING (app.is_admin()) WITH CHECK (app.is_admin());

-- ─── care.patient: the one policy that decides PHI visibility ──────────────────
CREATE POLICY read ON care.patient FOR SELECT TO tomoni_app USING (
  app.is_admin()
  OR practice_id = ANY(app.staff_practice_ids())
  OR household_id = ANY(app.household_ids())
  OR id = ANY(app.patient_ids())
  OR (practice_id = ANY(app.ops_practice_ids())
      AND EXISTS (SELECT 1 FROM care.practice pr WHERE pr.id = practice_id AND pr.offshore_ops_access)));
CREATE POLICY staff_insert ON care.patient FOR INSERT TO tomoni_app
  WITH CHECK (app.is_admin() OR practice_id = ANY(app.staff_practice_ids()));
CREATE POLICY staff_update ON care.patient FOR UPDATE TO tomoni_app
  USING (app.is_admin() OR practice_id = ANY(app.staff_practice_ids()))
  WITH CHECK (app.is_admin() OR practice_id = ANY(app.staff_practice_ids()));

-- ─── care.clinician ────────────────────────────────────────────────────────────
CREATE POLICY read ON care.clinician FOR SELECT TO tomoni_app USING (
  app.is_admin()
  OR practice_id = ANY(app.staff_practice_ids())
  OR practice_id = ANY(app.ops_practice_ids())
  OR practice_id = ANY(app.my_patient_practice_ids()));
CREATE POLICY admin_write ON care.clinician FOR ALL TO tomoni_app USING (app.is_admin()) WITH CHECK (app.is_admin());

-- ─── care.household / family_member ────────────────────────────────────────────
CREATE POLICY read ON care.household FOR SELECT TO tomoni_app USING (
  app.is_admin() OR id = ANY(app.household_ids()) OR id IN (SELECT household_id FROM care.patient));
CREATE POLICY staff_write ON care.household FOR ALL TO tomoni_app
  USING (app.is_admin() OR id IN (SELECT household_id FROM care.patient WHERE practice_id = ANY(app.staff_practice_ids())))
  WITH CHECK (app.is_admin() OR cardinality(app.staff_practice_ids()) > 0);

CREATE POLICY read ON care.family_member FOR SELECT TO tomoni_app USING (
  app.is_admin() OR household_id = ANY(app.household_ids()) OR household_id IN (SELECT household_id FROM care.patient));
CREATE POLICY staff_write ON care.family_member FOR ALL TO tomoni_app
  USING (app.is_admin() OR household_id IN (SELECT household_id FROM care.patient WHERE practice_id = ANY(app.staff_practice_ids())))
  WITH CHECK (app.is_admin() OR household_id IN (SELECT household_id FROM care.patient WHERE practice_id = ANY(app.staff_practice_ids())));

-- ─── Patient-scoped children ───────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['care.representative','care.care_consent','care.contact_consent'] LOOP
    EXECUTE format('CREATE POLICY read ON %s FOR SELECT TO tomoni_app USING (patient_id IN (SELECT id FROM care.patient))', t);
    EXECUTE format('CREATE POLICY staff_insert ON %s FOR INSERT TO tomoni_app WITH CHECK (app.can_write_patient(patient_id))', t);
    EXECUTE format('CREATE POLICY staff_update ON %s FOR UPDATE TO tomoni_app USING (app.can_write_patient(patient_id)) WITH CHECK (app.can_write_patient(patient_id))', t);
  END LOOP;
END $$;

-- ─── outbox: requests may only append ──────────────────────────────────────────
CREATE POLICY append ON care.outbox FOR INSERT TO tomoni_app WITH CHECK (true);

-- ─── audit.event: "who looked at my dad's data" ────────────────────────────────
CREATE POLICY read ON audit.event FOR SELECT TO tomoni_app USING (
  app.is_admin()
  OR actor_id = app.user_id()::text
  OR patient_id IN (SELECT id FROM care.patient));

-- ─── Grants ────────────────────────────────────────────────────────────────────
REVOKE ALL ON SCHEMA app, auth, care, research, audit, sponsor FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app, auth, care, audit FROM PUBLIC;

GRANT USAGE ON SCHEMA app, auth, care, audit TO tomoni_app, tomoni_worker;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO tomoni_app, tomoni_worker;

GRANT SELECT ON auth.user_account, auth.role_grant TO tomoni_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA auth TO tomoni_worker;

GRANT SELECT, INSERT, UPDATE ON care.practice, care.clinician, care.household, care.patient,
  care.family_member, care.representative, care.care_consent, care.contact_consent TO tomoni_app;
GRANT INSERT ON care.outbox TO tomoni_app;
GRANT USAGE ON SEQUENCE care.outbox_id_seq TO tomoni_app, tomoni_worker;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA care TO tomoni_worker;

GRANT SELECT ON audit.event TO tomoni_app, tomoni_worker;   -- no INSERT/UPDATE/DELETE: append() only
GRANT EXECUTE ON FUNCTION audit.append(text, text, text, uuid, text, jsonb) TO tomoni_app, tomoni_worker;
GRANT EXECUTE ON FUNCTION audit.seal(int) TO tomoni_worker;
GRANT EXECUTE ON FUNCTION audit.verify() TO tomoni_worker;

-- Sponsor role: schema usage on sponsor only. Functions arrive in Phase 5.
GRANT USAGE ON SCHEMA sponsor TO tomoni_sponsor;
