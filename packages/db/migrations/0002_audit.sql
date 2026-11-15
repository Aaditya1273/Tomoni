-- 0002 Append-only, hash-chained audit log (SECURITY S5).
--
-- Rows are appended inside the request transaction with hash = NULL. audit.seal(),
-- run by the worker every second, links unsealed rows into the chain in id order under
-- one advisory lock. Requests therefore never wait on each other for auditing.
-- Chain order is chain_seq (assigned at seal time), not id, because ids can commit out
-- of order.

CREATE TABLE audit.event (
  id           bigserial PRIMARY KEY,
  at           timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor_kind   text NOT NULL CHECK (actor_kind IN ('user','system','agent')),
  actor_id     text NOT NULL,
  actor_roles  text[] NOT NULL DEFAULT '{}',
  action       text NOT NULL CHECK (action IN ('read','create','update','delete','export','consent_change',
                                               'login','login_failed','logout','mfa_enrolled','agent_action',
                                               'approval')),
  entity_type  text NOT NULL,
  entity_id    text,
  patient_id   uuid,
  purpose      text NOT NULL CHECK (purpose IN ('treatment','operations','payment','research','support','security')),
  details      jsonb NOT NULL DEFAULT '{}',   -- ids and field names only, never PHI values
  chain_seq    bigint UNIQUE,
  prev_hash    bytea,
  hash         bytea
);
CREATE INDEX audit_unsealed ON audit.event (id) WHERE hash IS NULL;
CREATE INDEX ON audit.event (patient_id, at);
CREATE INDEX ON audit.event (actor_id, at);

-- Canonical form of a row for hashing: jsonb text output has deterministic key order.
CREATE FUNCTION audit.canonical(e audit.event) RETURNS bytea LANGUAGE sql IMMUTABLE AS $$
  SELECT convert_to(jsonb_build_object(
    'id', e.id, 'at', to_char(e.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'actor_kind', e.actor_kind, 'actor_id', e.actor_id, 'actor_roles', to_jsonb(e.actor_roles),
    'action', e.action, 'entity_type', e.entity_type, 'entity_id', e.entity_id,
    'patient_id', e.patient_id, 'purpose', e.purpose, 'details', e.details,
    'chain_seq', e.chain_seq)::text, 'UTF8')
$$;

-- Append. Actor comes from the request scope the API set (app.actor_kind / app.actor_id).
CREATE FUNCTION audit.append(
  p_action text, p_entity_type text, p_entity_id text, p_patient_id uuid,
  p_purpose text, p_details jsonb DEFAULT '{}'
) RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, audit AS $$
  INSERT INTO audit.event (actor_kind, actor_id, actor_roles, action, entity_type, entity_id,
                           patient_id, purpose, details)
  VALUES (coalesce(nullif(current_setting('app.actor_kind', true), ''), 'system'),
          coalesce(nullif(current_setting('app.actor_id', true), ''), 'system:unknown'),
          coalesce(string_to_array(nullif(current_setting('app.roles', true), ''), ','), '{}'),
          p_action, p_entity_type, p_entity_id, p_patient_id, p_purpose, coalesce(p_details, '{}'))
  RETURNING id
$$;

-- Seal unsealed rows into the chain. Returns the number sealed.
CREATE FUNCTION audit.seal(p_limit int DEFAULT 5000) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, audit AS $$
DECLARE
  r audit.event;
  last_seq bigint;
  last_hash bytea;
  n int := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('audit.seal'));
  SELECT chain_seq, hash INTO last_seq, last_hash FROM audit.event
    WHERE chain_seq IS NOT NULL ORDER BY chain_seq DESC LIMIT 1;
  last_seq := coalesce(last_seq, 0);
  last_hash := coalesce(last_hash, '\x00'::bytea);
  PERFORM set_config('audit.sealing', 'on', true);
  FOR r IN SELECT * FROM audit.event WHERE hash IS NULL ORDER BY id LIMIT p_limit FOR UPDATE LOOP
    last_seq := last_seq + 1;
    r.chain_seq := last_seq;
    UPDATE audit.event
       SET chain_seq = last_seq,
           prev_hash = last_hash,
           hash = public.digest(last_hash || audit.canonical(r), 'sha256')
     WHERE id = r.id
     RETURNING hash INTO last_hash;
    n := n + 1;
  END LOOP;
  PERFORM set_config('audit.sealing', 'off', true);
  RETURN n;
END $$;

-- Recompute the chain. Returns the chain_seq of the first broken link, or NULL if intact.
CREATE FUNCTION audit.verify() RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, audit AS $$
DECLARE
  r audit.event;
  expect_prev bytea := '\x00'::bytea;
  expect_seq bigint := 0;
BEGIN
  FOR r IN SELECT * FROM audit.event WHERE chain_seq IS NOT NULL ORDER BY chain_seq LOOP
    expect_seq := expect_seq + 1;
    IF r.chain_seq <> expect_seq
       OR r.prev_hash IS DISTINCT FROM expect_prev
       OR r.hash IS DISTINCT FROM public.digest(expect_prev || audit.canonical(r), 'sha256') THEN
      RETURN coalesce(r.chain_seq, -1);
    END IF;
    expect_prev := r.hash;
  END LOOP;
  RETURN NULL;
END $$;

-- Append-only guard: no DELETE/TRUNCATE ever; UPDATE only by audit.seal() on unsealed rows,
-- and only of the chain columns.
CREATE FUNCTION audit.guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND current_setting('audit.sealing', true) = 'on'
     AND OLD.hash IS NULL
     AND (to_jsonb(NEW) - 'chain_seq' - 'prev_hash' - 'hash') = (to_jsonb(OLD) - 'chain_seq' - 'prev_hash' - 'hash')
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit.event is append-only (% blocked)', TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER guard_update BEFORE UPDATE OR DELETE ON audit.event FOR EACH ROW EXECUTE FUNCTION audit.guard();
CREATE TRIGGER guard_truncate BEFORE TRUNCATE ON audit.event FOR EACH STATEMENT EXECUTE FUNCTION audit.guard();
