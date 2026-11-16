-- 0022 Voice pre-screen (Trial Bridge step 2). A trial's ethics-approved yes/no questions are
-- asked on the daily call, after the care tasks, only with active trial-matching consent. The
-- answers live in the research schema under the pseudonym, never in the care transcript.
-- All answers as approved -> 'prescreened' (a billable unit of work); otherwise 'ineligible'.

CREATE TABLE research.prescreen_question (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  trial_id         uuid NOT NULL REFERENCES research.trial(id),
  ordinal          int NOT NULL CHECK (ordinal BETWEEN 1 AND 5),
  wording          jsonb NOT NULL CHECK (jsonb_typeof(wording->'en') = 'string'), -- {"en": …, "hi": …}
  eligible_answer  text NOT NULL CHECK (eligible_answer IN ('yes','no')),
  approval_ref     text NOT NULL CHECK (length(approval_ref) BETWEEN 3 AND 100),     -- the ethics approval
  UNIQUE (trial_id, ordinal)
);

CREATE TABLE research.prescreen_answer (
  match_id     uuid NOT NULL REFERENCES research.trial_match(id),
  question_id  uuid NOT NULL REFERENCES research.prescreen_question(id),
  answer       text NOT NULL CHECK (answer IN ('yes','no')),
  answered_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, question_id)
);

ALTER TABLE research.prescreen_question ENABLE ROW LEVEL SECURITY;
ALTER TABLE research.prescreen_answer ENABLE ROW LEVEL SECURITY;
CREATE POLICY worker_all ON research.prescreen_question TO tomoni_worker USING (true) WITH CHECK (true);
CREATE POLICY consented ON research.prescreen_answer TO tomoni_worker
  USING (EXISTS (SELECT 1 FROM research.trial_match m WHERE m.id = match_id
                  AND research.pid_has_consent(m.research_pid, 'trial_matching')));
GRANT SELECT, INSERT, UPDATE ON research.prescreen_question TO tomoni_worker;
GRANT SELECT ON research.prescreen_answer TO tomoni_worker;

-- What the call may ask: the oldest open match with approved questions, in the patient's
-- language (English when no approved translation exists). Nothing without consent.
CREATE FUNCTION research.prescreen_for_call(p_patient uuid, p_locale text)
RETURNS TABLE (match_id uuid, questions jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, research AS $$
  SELECT m.id, (SELECT jsonb_agg(jsonb_build_object('id', q.id,
                   'text', coalesce(q.wording->>p_locale, q.wording->>'en')) ORDER BY q.ordinal)
                  FROM research.prescreen_question q WHERE q.trial_id = m.trial_id)
    FROM research.trial_match m JOIN research.research_id r ON r.research_pid = m.research_pid
    JOIN research.trial t ON t.id = m.trial_id
   WHERE r.patient_id = p_patient AND m.status = 'matched' AND t.status = 'recruiting'
     AND research.has_active_consent(p_patient, 'trial_matching')
     AND EXISTS (SELECT 1 FROM research.prescreen_question q WHERE q.trial_id = m.trial_id)
   ORDER BY m.matched_at LIMIT 1;
$$;

-- Records the answers from a live call and moves the match. Returns the new status, or null when
-- the call, consent or match doesn't hold (nothing is stored then).
CREATE FUNCTION research.record_prescreen(p_call uuid, p_match uuid, p_answers jsonb)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, research, care AS $$
DECLARE
  pid uuid; m research.trial_match; total int; given int; fit boolean; outcome text;
BEGIN
  SELECT c.patient_id INTO pid FROM care.call c
   WHERE c.id = p_call AND c.started_at > now() - interval '2 hours' AND c.ended_at IS NULL;
  IF pid IS NULL OR NOT research.has_active_consent(pid, 'trial_matching') THEN RETURN NULL; END IF;
  SELECT tm.* INTO m FROM research.trial_match tm JOIN research.research_id r ON r.research_pid = tm.research_pid
   WHERE tm.id = p_match AND r.patient_id = pid AND tm.status = 'matched' FOR UPDATE OF tm;
  IF m.id IS NULL THEN RETURN NULL; END IF;

  SELECT count(*), count(a.value), coalesce(bool_and(a.value = q.eligible_answer), false)
    INTO total, given, fit
    FROM research.prescreen_question q LEFT JOIN LATERAL (
      SELECT p_answers->>q.id::text AS value WHERE p_answers->>q.id::text IN ('yes','no')) a ON true
   WHERE q.trial_id = m.trial_id;
  IF total = 0 OR given < total THEN RETURN NULL; END IF; -- only a complete pre-screen counts

  INSERT INTO research.prescreen_answer (match_id, question_id, answer)
  SELECT m.id, q.id, p_answers->>q.id::text FROM research.prescreen_question q WHERE q.trial_id = m.trial_id;
  outcome := CASE WHEN fit THEN 'prescreened' ELSE 'ineligible' END;
  UPDATE research.trial_match SET status = outcome WHERE id = m.id;
  IF fit THEN
    INSERT INTO research.service_event (sponsor_id, trial_id, trial_match_id, unit)
    SELECT t.sponsor_id, t.id, m.id, 'prescreen_completed' FROM research.trial t WHERE t.id = m.trial_id;
  END IF;
  RETURN outcome;
END $$;

REVOKE ALL ON FUNCTION research.prescreen_for_call(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION research.record_prescreen(uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION research.prescreen_for_call(uuid, text) TO tomoni_app, tomoni_worker;
GRANT EXECUTE ON FUNCTION research.record_prescreen(uuid, uuid, jsonb) TO tomoni_app, tomoni_worker;
