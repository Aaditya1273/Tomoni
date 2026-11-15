-- 0005 TOTP replay protection: a code's time step can be used once per account.
ALTER TABLE auth.user_account ADD COLUMN mfa_last_step bigint;

DROP FUNCTION auth.login_lookup(citext);
CREATE FUNCTION auth.login_lookup(p_email citext)
RETURNS TABLE (id uuid, password_hash text, mfa_secret bytea, mfa_enabled_at timestamptz,
               status text, locked_until timestamptz, mfa_last_step bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, auth AS $$
  SELECT id, password_hash, mfa_secret, mfa_enabled_at, status, locked_until, mfa_last_step
    FROM auth.user_account WHERE email = p_email
$$;

CREATE FUNCTION auth.mfa_state(p_user uuid)
RETURNS TABLE (mfa_secret bytea, mfa_enabled_at timestamptz, mfa_last_step bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, auth AS $$
  SELECT mfa_secret, mfa_enabled_at, mfa_last_step FROM auth.user_account WHERE id = p_user
$$;

-- Atomically claim a time step. Returns false if it (or a later one) was already used.
CREATE FUNCTION auth.claim_mfa_step(p_user uuid, p_step bigint) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, auth AS $$
  WITH u AS (
    UPDATE auth.user_account SET mfa_last_step = p_step
     WHERE id = p_user AND (mfa_last_step IS NULL OR mfa_last_step < p_step)
    RETURNING 1
  ) SELECT EXISTS (SELECT 1 FROM u)
$$;

-- Rotate a session id (after MFA) keeping its settings.
CREATE FUNCTION auth.session_rotate(p_old bytea, p_new bytea, p_csrf bytea, p_mfa boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, auth AS $$
DECLARE s auth.session;
BEGIN
  UPDATE auth.session SET revoked_at = now() WHERE id_hash = p_old AND revoked_at IS NULL RETURNING * INTO s;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO auth.session (id_hash, user_id, csrf_token_hash, mfa_verified_at, idle_timeout_s,
                            absolute_expires_at, user_agent)
  VALUES (p_new, s.user_id, p_csrf, CASE WHEN p_mfa THEN now() ELSE s.mfa_verified_at END,
          s.idle_timeout_s, s.absolute_expires_at, s.user_agent);
  RETURN true;
END $$;

-- Active grants of a user, for the login step (before a session exists).
CREATE FUNCTION auth.user_grants(p_user uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, auth AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'role', role, 'practiceId', practice_id, 'householdId', household_id,
           'patientId', patient_id, 'sponsorId', sponsor_id)), '[]')
    FROM auth.role_grant WHERE user_id = p_user AND revoked_at IS NULL
$$;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA auth FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO tomoni_app;
