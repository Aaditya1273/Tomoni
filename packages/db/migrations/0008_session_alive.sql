-- 0008 Read-only session check for long-lived connections (SSE). Unlike session_resolve it does
-- NOT touch last_seen_at, so an open event stream never keeps an idle session alive (S8).
CREATE FUNCTION auth.session_alive(p_id_hash bytea) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, auth AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.session s JOIN auth.user_account u ON u.id = s.user_id
     WHERE s.id_hash = p_id_hash AND s.revoked_at IS NULL AND u.status = 'active'
       AND s.absolute_expires_at > now()
       AND s.last_seen_at + make_interval(secs => s.idle_timeout_s) > now())
$$;
REVOKE EXECUTE ON FUNCTION auth.session_alive(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.session_alive(bytea) TO tomoni_app;
