-- 0014 Trial Bridge and the sponsor portal (Phase 5, rules 2.5, 2.7, 2.9; D-010).
--
-- Matches carry only the research pseudonym. Sponsors never read a table: tomoni_sponsor may only
-- EXECUTE sponsor.* functions, which return aggregates that are suppressed under 11, rounded to 5,
-- and secondarily suppressed so a hidden cell can't be recovered by subtraction.

CREATE FUNCTION app.sponsor_ids() RETURNS uuid[] LANGUAGE sql STABLE AS $$ SELECT app.uuids('app.sponsor_ids') $$;
GRANT EXECUTE ON FUNCTION app.sponsor_ids() TO tomoni_app, tomoni_worker, tomoni_sponsor;
GRANT USAGE ON SCHEMA app TO tomoni_sponsor;
GRANT EXECUTE ON FUNCTION app.uuids(text), app.setting(text) TO tomoni_sponsor;

CREATE TABLE research.sponsor (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  name        text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('sponsor','cro')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- D-010 and rule 2.7: fees are for work done, set by admins at fair market value. There is no
-- per-randomized-participant unit and nothing here can pay a clinician.
CREATE TABLE research.service_rate (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  sponsor_id  uuid NOT NULL REFERENCES research.sponsor(id),
  unit        text NOT NULL CHECK (unit IN ('prescreen_completed','introduction_delivered','consent_prep_call',
                                            'retention_participant_month','study_hours','feasibility_report')),
  rate_cents  int NOT NULL CHECK (rate_cents >= 0),
  valid_from  date NOT NULL,
  set_by      uuid NOT NULL REFERENCES auth.user_account(id),
  UNIQUE (sponsor_id, unit, valid_from)
);

CREATE TABLE research.trial (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  sponsor_id        uuid NOT NULL REFERENCES research.sponsor(id),
  title             text NOT NULL,
  nct_id            text CHECK (nct_id ~ '^NCT\d{8}$'),
  therapeutic_area  text NOT NULL,
  status            text NOT NULL DEFAULT 'recruiting' CHECK (status IN ('draft','recruiting','closed')),
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- A closed set of criteria with coarse values (SECURITY: differencing), so a sponsor can't build
-- a query that singles one person out.
CREATE TABLE research.trial_criterion (
  id        uuid PRIMARY KEY DEFAULT uuidv7(),
  trial_id  uuid NOT NULL REFERENCES research.trial(id),
  field     text NOT NULL CHECK (field IN ('age_band_min','age_band_max','condition_any','drug_any',
                                           'inpatient_within_days','language_any')),
  value     jsonb NOT NULL
);

CREATE TABLE research.trial_match (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  trial_id      uuid NOT NULL REFERENCES research.trial(id),
  research_pid  uuid NOT NULL REFERENCES research.research_id(research_pid),
  status        text NOT NULL DEFAULT 'matched'
                CHECK (status IN ('matched','prescreened','introduced','consent_prep','referred','randomized',
                                  'declined','ineligible','withdrawn')),
  matched_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trial_id, research_pid)
);
CREATE TRIGGER touch BEFORE UPDATE ON research.trial_match FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Billable work, one row per unit delivered. Never tied to a trial outcome.
CREATE TABLE research.service_event (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  sponsor_id      uuid NOT NULL REFERENCES research.sponsor(id),
  trial_id        uuid REFERENCES research.trial(id),
  trial_match_id  uuid REFERENCES research.trial_match(id),
  unit            text NOT NULL CHECK (unit IN ('prescreen_completed','introduction_delivered','consent_prep_call',
                                                'retention_participant_month','study_hours','feasibility_report')),
  occurred_at     timestamptz NOT NULL DEFAULT now()
);

-- ─── RLS: research data is reachable only with active consent (rule 2.5) ──────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['research.sponsor','research.service_rate','research.trial','research.trial_criterion',
                           'research.trial_match','research.service_event'] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
-- The worker matches and records work, but a match row is visible to it only while the person's
-- trial-matching consent is active: withdrawal hides it on the next statement.
CREATE POLICY worker_consented ON research.trial_match TO tomoni_worker
  USING (EXISTS (SELECT 1 FROM research.research_id r WHERE r.research_pid = trial_match.research_pid
                  AND research.has_active_consent(r.patient_id, 'trial_matching')))
  WITH CHECK (EXISTS (SELECT 1 FROM research.research_id r WHERE r.research_pid = trial_match.research_pid
                  AND research.has_active_consent(r.patient_id, 'trial_matching')));
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['research.sponsor','research.service_rate','research.trial','research.trial_criterion',
                           'research.service_event'] LOOP
    EXECUTE format('CREATE POLICY worker_all ON %s TO tomoni_worker USING (true) WITH CHECK (true)', t);
    EXECUTE format('CREATE POLICY admin_all ON %s TO tomoni_app USING (app.is_admin()) WITH CHECK (app.is_admin())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON research.sponsor, research.service_rate, research.trial, research.trial_criterion,
  research.service_event TO tomoni_app, tomoni_worker;
GRANT SELECT, INSERT, UPDATE ON research.trial_match TO tomoni_worker;

-- ─── Sponsor functions: aggregates only (rule 2.9) ────────────────────────────
-- Suppress 1–10 (counts under 11) and round everything else to the nearest 5.
CREATE FUNCTION sponsor.safe(n bigint) RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN n IS NULL OR n = 0 THEN 0 WHEN n < 11 THEN NULL ELSE (round(n / 5.0) * 5)::int END
$$;

-- The caller's sponsor, from the session scope the sponsor API sets. Never a parameter.
CREATE FUNCTION sponsor.me() RETURNS uuid LANGUAGE plpgsql STABLE AS $$
DECLARE ids uuid[] := app.sponsor_ids();
BEGIN
  IF cardinality(ids) <> 1 THEN RAISE EXCEPTION 'no sponsor scope' USING ERRCODE = 'insufficient_privilege'; END IF;
  RETURN ids[1];
END $$;

-- Who is in the research pool for trial matching right now: consented, approved, unexpired.
CREATE FUNCTION sponsor.pool() RETURNS TABLE (patient_id uuid, birth_year int, locale text, state text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, care, research AS $$
  SELECT p.id, p.birth_year, p.locale, p.state FROM care.patient p
   WHERE p.status = 'active' AND research.has_active_consent(p.id, 'trial_matching')
$$;
REVOKE EXECUTE ON FUNCTION sponsor.pool() FROM PUBLIC;

/**
 * Feasibility: how many consented registry members fit coarse criteria, by 5-year age band.
 * criteria: {"conditions": ["heart_failure"], "languages": ["gu","hi"], "inpatient_within_days": 365}
 */
CREATE FUNCTION sponsor.feasibility(criteria jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, care, research, sponsor AS $$
DECLARE
  me uuid := sponsor.me();
  conds text[] := ARRAY(SELECT jsonb_array_elements_text(coalesce(criteria->'conditions', '[]')));
  langs text[] := ARRAY(SELECT jsonb_array_elements_text(coalesce(criteria->'languages', '[]')));
  days int := least(coalesce((criteria->>'inpatient_within_days')::int, 0), 730);
  bands jsonb;
  total bigint;
  shown jsonb;
BEGIN
  -- Closed vocabulary: anything outside it is refused, not ignored.
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(criteria) k WHERE k NOT IN ('conditions','languages','inpatient_within_days'))
     OR EXISTS (SELECT 1 FROM unnest(conds) c WHERE c NOT IN ('diabetes','hypertension','hyperlipidemia','coronary_artery_disease',
               'heart_failure','atrial_fibrillation','copd','asthma','ckd','hypothyroidism','dementia','depression','osteoarthritis','bph'))
     OR EXISTS (SELECT 1 FROM unnest(langs) l WHERE l NOT IN ('en','hi','gu','ta','pa','bn'))
     OR days NOT IN (0, 90, 180, 365, 730) THEN
    RAISE EXCEPTION 'criteria outside the allowed set' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  WITH cohort AS (
    SELECT pl.patient_id, pl.birth_year FROM sponsor.pool() pl
     WHERE (cardinality(langs) = 0 OR pl.locale = ANY(langs))
       AND (cardinality(conds) = 0 OR EXISTS (
            SELECT 1 FROM care.claim c, unnest(c.dx_codes) dx
             WHERE c.patient_id = pl.patient_id AND c.start_date > current_date - 730
               AND sponsor.condition_of(dx) = ANY(conds)))
       AND (days = 0 OR EXISTS (SELECT 1 FROM care.claim c WHERE c.patient_id = pl.patient_id
                                  AND c.kind = 'inpatient' AND c.start_date > current_date - days))
  ), banded AS (
    SELECT CASE WHEN extract(year FROM current_date) - birth_year >= 85 THEN '85+'
                ELSE (floor((extract(year FROM current_date) - birth_year) / 5) * 5)::int || '-' ||
                     (floor((extract(year FROM current_date) - birth_year) / 5) * 5 + 4)::int END AS band,
           count(*) AS n
      FROM cohort GROUP BY 1
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('band', band, 'n', n) ORDER BY band), '[]'), (SELECT count(*) FROM cohort)
    INTO bands, total FROM banded;
  -- Secondary suppression: if exactly one band is hidden, hide the next smallest too, so the total
  -- minus the shown bands never reveals it.
  WITH b AS (SELECT x->>'band' AS band, (x->>'n')::bigint AS n FROM jsonb_array_elements(bands) x),
       hidden AS (SELECT count(*) FILTER (WHERE n < 11) AS h FROM b),
       extra AS (SELECT band FROM b WHERE n >= 11 AND (SELECT h FROM hidden) = 1 ORDER BY n, band LIMIT 1)
  SELECT coalesce(jsonb_agg(jsonb_build_object('band', b.band,
           'n', CASE WHEN b.band IN (SELECT band FROM extra) THEN NULL ELSE sponsor.safe(b.n) END) ORDER BY b.band), '[]')
    INTO shown FROM b;
  PERFORM audit.append('export', 'feasibility', me::text, NULL, 'research', jsonb_build_object('criteria', criteria));
  RETURN jsonb_build_object('total', sponsor.safe(total), 'byAgeBand', shown, 'suppressedUnder', 11, 'roundedTo', 5);
END $$;

CREATE FUNCTION sponsor.condition_of(dx text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN dx ~ '^E(08|09|10|11|13)' THEN 'diabetes' WHEN dx ~ '^I1[0-6]' THEN 'hypertension'
    WHEN dx ~ '^E78' THEN 'hyperlipidemia' WHEN dx ~ '^I2[0-5]' THEN 'coronary_artery_disease'
    WHEN dx ~ '^I50' THEN 'heart_failure' WHEN dx ~ '^I48' THEN 'atrial_fibrillation'
    WHEN dx ~ '^J4[34]' THEN 'copd' WHEN dx ~ '^J45' THEN 'asthma' WHEN dx ~ '^N18' THEN 'ckd'
    WHEN dx ~ '^E03' THEN 'hypothyroidism' WHEN dx ~ '^(F0[123]|G30)' THEN 'dementia'
    WHEN dx ~ '^F3[23]' THEN 'depression' WHEN dx ~ '^M1[5-9]' THEN 'osteoarthritis' WHEN dx ~ '^N40' THEN 'bph'
  END
$$;

-- The funnel for one of the caller's trials: counts per stage, suppressed and rounded.
CREATE FUNCTION sponsor.funnel(p_trial uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, research, sponsor AS $$
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM research.trial t WHERE t.id = p_trial AND t.sponsor_id = sponsor.me())
    THEN NULL
    ELSE (SELECT jsonb_object_agg(s, sponsor.safe(coalesce(n, 0)))
            FROM unnest(ARRAY['matched','prescreened','introduced','consent_prep','referred','randomized']) s
            LEFT JOIN (SELECT m.status, count(*) AS n FROM research.trial_match m
                        JOIN research.research_id r ON r.research_pid = m.research_pid
                       WHERE m.trial_id = p_trial AND research.has_active_consent(r.patient_id, 'trial_matching')
                       GROUP BY m.status) c ON c.status = s)
  END
$$;

CREATE FUNCTION sponsor.trials() RETURNS TABLE (id uuid, title text, nct_id text, therapeutic_area text, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, research, sponsor AS $$
  SELECT id, title, nct_id, therapeutic_area, status FROM research.trial WHERE sponsor_id = sponsor.me() ORDER BY created_at
$$;

-- What the sponsor has been billed for, by month and unit (work done, never outcomes).
CREATE FUNCTION sponsor.usage() RETURNS TABLE (month text, unit text, units bigint, amount_cents bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, research, sponsor AS $$
  SELECT to_char(e.occurred_at, 'YYYY-MM'), e.unit, count(*),
         sum((SELECT r.rate_cents FROM research.service_rate r WHERE r.sponsor_id = e.sponsor_id AND r.unit = e.unit
               AND r.valid_from <= e.occurred_at::date ORDER BY r.valid_from DESC LIMIT 1))
    FROM research.service_event e WHERE e.sponsor_id = sponsor.me()
   GROUP BY 1, 2 ORDER BY 1, 2
$$;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA sponsor FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sponsor.feasibility(jsonb), sponsor.funnel(uuid), sponsor.trials(), sponsor.usage(),
  sponsor.me(), sponsor.safe(bigint), sponsor.condition_of(text) TO tomoni_sponsor;
