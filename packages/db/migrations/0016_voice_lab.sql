-- 0016 Voice Lab (Phase 6, rules 2.5 and 2.8). The daily call may end with an optional research
-- speech task, only with active speech-task consent. Samples carry the pseudonym, never the
-- patient id; their features are research-only and no care, family or sponsor role can read them.

-- Consent by pseudonym, for policies on tables that only carry research_pid.
CREATE FUNCTION research.pid_has_consent(rpid uuid, scope text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, research AS $$
  SELECT EXISTS (SELECT 1 FROM research.research_id r
                  WHERE r.research_pid = rpid AND research.has_active_consent(r.patient_id, scope));
$$;
REVOKE EXECUTE ON FUNCTION research.pid_has_consent(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION research.pid_has_consent(uuid, text) TO tomoni_worker;

CREATE TABLE research.speech_sample (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  research_pid     uuid NOT NULL REFERENCES research.research_id(research_pid),
  consent_id       uuid NOT NULL REFERENCES research.research_consent(id),
  task_code        text NOT NULL CHECK (task_code ~ '^[a-z_]{1,40}$'),
  task_version     int NOT NULL CHECK (task_version > 0),
  locale           text NOT NULL,
  recorded_on      date NOT NULL,
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  duration_ms      int NOT NULL CHECK (duration_ms BETWEEN 0 AND 120000),
  audio_ref        text,                    -- research-only bucket prefix; null when no audio was captured
  features         jsonb,                   -- ResearchOnly<SpeechFeatures>
  feature_version  text,
  CHECK ((features IS NULL) = (feature_version IS NULL)),
  UNIQUE (research_pid, task_code, recorded_on)
);

-- Outcome labels from claims, for patients in the speech dataset only.
CREATE TABLE research.outcome_label (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  research_pid     uuid NOT NULL REFERENCES research.research_id(research_pid),
  kind             text NOT NULL CHECK (kind IN ('inpatient_stay','ed_visit','new_dx')),
  start_date       date NOT NULL,
  source_claim_id  uuid NOT NULL REFERENCES care.claim(id),
  UNIQUE (source_claim_id, kind)
);

ALTER TABLE research.speech_sample ENABLE ROW LEVEL SECURITY;
ALTER TABLE research.outcome_label ENABLE ROW LEVEL SECURITY;
-- Only the worker reads them, and only while consent is active: a withdrawal hides the rows on
-- the next statement. tomoni_app and tomoni_sponsor get no grant at all.
CREATE POLICY consented ON research.speech_sample TO tomoni_worker
  USING (research.pid_has_consent(research_pid, 'speech_task'))
  WITH CHECK (research.pid_has_consent(research_pid, 'speech_task'));
CREATE POLICY consented ON research.outcome_label TO tomoni_worker
  USING (research.pid_has_consent(research_pid, 'speech_task'))
  WITH CHECK (research.pid_has_consent(research_pid, 'speech_task'));
GRANT SELECT, INSERT, UPDATE ON research.speech_sample, research.outcome_label TO tomoni_worker;

-- The call service records a sample through this function, so the care role never touches the
-- pseudonym table. It needs a live call for that patient, and returns null without consent.
CREATE FUNCTION research.record_speech_sample(p_call uuid, p_task text, p_version int, p_duration_ms int)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, research, care AS $$
DECLARE
  pid uuid; loc text; cid uuid; rpid uuid; sid uuid;
BEGIN
  SELECT c.patient_id, c.locale INTO pid, loc FROM care.call c
   WHERE c.id = p_call AND c.started_at > now() - interval '2 hours' AND c.ended_at IS NULL;
  IF pid IS NULL OR NOT research.has_active_consent(pid, 'speech_task') THEN RETURN NULL; END IF;
  SELECT rc.id INTO cid FROM research.research_consent rc
   WHERE rc.patient_id = pid AND rc.withdrawn_at IS NULL AND rc.scope_speech_task
   ORDER BY rc.given_at DESC LIMIT 1;
  INSERT INTO research.research_id (patient_id) VALUES (pid) ON CONFLICT DO NOTHING;
  SELECT r.research_pid INTO rpid FROM research.research_id r WHERE r.patient_id = pid;
  INSERT INTO research.speech_sample (research_pid, consent_id, task_code, task_version, locale, recorded_on, duration_ms)
  VALUES (rpid, cid, p_task, p_version, loc, current_date, least(greatest(p_duration_ms, 0), 120000))
  ON CONFLICT (research_pid, task_code, recorded_on) DO NOTHING
  RETURNING id INTO sid;
  RETURN sid;
END $$;
REVOKE ALL ON FUNCTION research.record_speech_sample(uuid, text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION research.record_speech_sample(uuid, text, int, int) TO tomoni_app, tomoni_worker;
