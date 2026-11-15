-- 0004 Auth entry points. tomoni_app cannot read auth.session or other users' accounts;
-- login and session resolution go through these SECURITY DEFINER functions only.

CREATE FUNCTION auth.login_lookup(p_email citext)
RETURNS TABLE (id uuid, password_hash text, mfa_secret bytea, mfa_enabled_at timestamptz,
               status text, locked_until timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, auth AS $$
  SELECT id, password_hash, mfa_secret, mfa_enabled_at, status, locked_until
    FROM auth.user_account WHERE email = p_email
$$;

-- 5 failures → locked for 15 minutes (SECURITY S8).
CREATE FUNCTION auth.record_login_failure(p_user uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, auth AS $$
  UPDATE auth.user_account
     SET failed_logins = failed_logins + 1,
         locked_until = CASE WHEN failed_logins + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END
   WHERE id = p_user
$$;

CREATE FUNCTION auth.record_login_success(p_user uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, auth AS $$
  UPDATE auth.user_account SET failed_logins = 0, locked_until = NULL WHERE id = p_user
$$;

CREATE FUNCTION auth.set_mfa_secret(p_user uuid, p_secret bytea) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, auth AS $$
  UPDATE auth.user_account SET mfa_secret = p_secret, mfa_enabled_at = NULL WHERE id = p_user
$$;

CREATE FUNCTION auth.enable_mfa(p_user uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, auth AS $$
  UPDATE auth.user_account SET mfa_enabled_at = now() WHERE id = p_user AND mfa_secret IS NOT NULL
$$;

CREATE FUNCTION auth.session_create(p_id_hash bytea, p_user uuid, p_csrf_hash bytea, p_idle_s int,
                                    p_absolute interval, p_user_agent text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, auth AS $$
  INSERT INTO auth.session (id_hash, user_id, csrf_token_hash, idle_timeout_s, absolute_expires_at, user_agent)
  VALUES (p_id_hash, p_user, p_csrf_hash, p_idle_s, now() + p_absolute, left(p_user_agent, 300))
$$;

-- Resolve a live session and slide its idle window. Returns no row if missing, revoked,
-- idle-expired or past its absolute limit.
CREATE FUNCTION auth.session_resolve(p_id_hash bytea)
RETURNS TABLE (user_id uuid, email citext, display_name text, csrf_token_hash bytea,
               mfa_verified boolean, mfa_enabled boolean, grants jsonb)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, auth AS $$
  WITH live AS (
    UPDATE auth.session s SET last_seen_at = now()
     WHERE s.id_hash = p_id_hash AND s.revoked_at IS NULL
       AND s.absolute_expires_at > now()
       AND s.last_seen_at + make_interval(secs => s.idle_timeout_s) > now()
    RETURNING s.*
  )
  SELECT u.id, u.email, u.display_name, live.csrf_token_hash,
         live.mfa_verified_at IS NOT NULL, u.mfa_enabled_at IS NOT NULL,
         coalesce((SELECT jsonb_agg(jsonb_build_object(
                     'role', g.role, 'practiceId', g.practice_id, 'householdId', g.household_id,
                     'patientId', g.patient_id, 'sponsorId', g.sponsor_id))
                     FROM auth.role_grant g WHERE g.user_id = u.id AND g.revoked_at IS NULL), '[]')
    FROM live JOIN auth.user_account u ON u.id = live.user_id
   WHERE u.status = 'active'
$$;

CREATE FUNCTION auth.session_mark_mfa(p_id_hash bytea) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, auth AS $$
  UPDATE auth.session SET mfa_verified_at = now() WHERE id_hash = p_id_hash AND revoked_at IS NULL
$$;

CREATE FUNCTION auth.session_revoke(p_id_hash bytea) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, auth AS $$
  UPDATE auth.session SET revoked_at = now() WHERE id_hash = p_id_hash
$$;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA auth FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO tomoni_app;
