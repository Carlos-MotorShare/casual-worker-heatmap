-- Weekend roster: can_roster flag, roster rows expose roster-user admin, tighter delete rules.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS can_roster boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.users.can_roster IS 'When true, may assign/remove weekend rosters for others via API';

-- Roster fetch: include whether the roster owner is an admin (heatmap hides these).
DROP FUNCTION IF EXISTS public.rosters_for_range (jsonb);

CREATE OR REPLACE FUNCTION public.rosters_for_range (payload jsonb)
RETURNS TABLE (
  block_id uuid,
  roster_id uuid,
  user_id uuid,
  roster_date date,
  username text,
  colour text,
  roster_user_admin boolean,
  start_time time,
  end_time time
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    rb.id,
    r.id,
    r.user_id,
    r.date,
    u.username,
    u.colour,
    COALESCE(u.admin, false),
    rb.start_time,
    rb.end_time
  FROM public.rosters r
  JOIN public.users u ON u.id = r.user_id
  JOIN public.roster_blocks rb ON rb.roster_id = r.id
  WHERE r.date >= (payload->>'start')::date
    AND r.date <= (payload->>'end')::date
  ORDER BY r.date, u.username, rb.start_time;
$$;

REVOKE ALL ON FUNCTION public.rosters_for_range (jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rosters_for_range (jsonb) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.login_with_password (payload jsonb);

CREATE OR REPLACE FUNCTION public.login_with_password (payload jsonb)
RETURNS TABLE (
  id uuid,
  username text,
  colour text,
  admin boolean,
  can_roster boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.id,
    u.username,
    u.colour,
    COALESCE(u.admin, false),
    COALESCE(u.can_roster, false)
  FROM public.users u
  WHERE u.password = payload->>'password'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.login_with_password (payload jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.login_with_password (payload jsonb) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_user_flags (p_user_id uuid)
RETURNS TABLE (
  admin boolean,
  can_roster boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(u.admin, false), COALESCE(u.can_roster, false)
  FROM public.users u
  WHERE u.id = p_user_id;
$$;

REVOKE ALL ON FUNCTION public.get_user_flags (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_flags (uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_worker_users ()
RETURNS TABLE (
  id uuid,
  username text,
  colour text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.username::text, u.colour::text
  FROM public.users u
  WHERE COALESCE(u.admin, false) = false
  ORDER BY u.username;
$$;

REVOKE ALL ON FUNCTION public.list_worker_users () FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_worker_users () TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.delete_roster_block (payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  bid uuid := (payload->>'blockId')::uuid;
  actor uuid := (payload->>'actorUserId')::uuid;
  owner_id uuid;
  rid uuid;
  roster_d date;
  is_admin boolean;
  actor_can_roster boolean;
  dow int;
  remaining int;
BEGIN
  IF bid IS NULL OR actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_payload');
  END IF;

  SELECT rb.roster_id, r.user_id, r.date
  INTO rid, owner_id, roster_d
  FROM public.roster_blocks rb
  JOIN public.rosters r ON r.id = rb.roster_id
  WHERE rb.id = bid;

  IF rid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  SELECT COALESCE(u.admin, false), COALESCE(u.can_roster, false)
  INTO is_admin, actor_can_roster
  FROM public.users u
  WHERE u.id = actor;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT EXTRACT(ISODOW FROM roster_d)::int INTO dow;

  IF actor = owner_id OR is_admin THEN
    NULL;
  ELSIF actor_can_roster AND dow >= 6 THEN
    NULL;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  DELETE FROM public.roster_blocks WHERE id = bid;

  SELECT COUNT(*)::int INTO remaining FROM public.roster_blocks WHERE roster_id = rid;
  IF remaining = 0 THEN
    DELETE FROM public.rosters WHERE id = rid;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_roster_block (jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_roster_block (jsonb) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
