-- Per-user colour, admin flag; roster fetch includes block id + colour; safe delete RPC.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS colour text;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS admin boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.users.colour IS 'CSS hex e.g. #FFFFFF for calendar markers';

DROP FUNCTION IF EXISTS public.rosters_for_range (jsonb);

CREATE OR REPLACE FUNCTION public.rosters_for_range (payload jsonb)
RETURNS TABLE (
  block_id uuid,
  roster_id uuid,
  user_id uuid,
  roster_date date,
  username text,
  colour text,
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
  admin boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.id,
    u.username,
    u.colour,
    COALESCE(u.admin, false)
  FROM public.users u
  WHERE u.password = payload->>'password'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.login_with_password (payload jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.login_with_password (payload jsonb) TO anon, authenticated;

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
  is_admin boolean;
  remaining int;
BEGIN
  IF bid IS NULL OR actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_payload');
  END IF;

  SELECT rb.roster_id, r.user_id
  INTO rid, owner_id
  FROM public.roster_blocks rb
  JOIN public.rosters r ON r.id = rb.roster_id
  WHERE rb.id = bid;

  IF rid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  SELECT COALESCE(u.admin, false)
  INTO is_admin
  FROM public.users u
  WHERE u.id = actor;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF actor IS DISTINCT FROM owner_id AND NOT is_admin THEN
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
