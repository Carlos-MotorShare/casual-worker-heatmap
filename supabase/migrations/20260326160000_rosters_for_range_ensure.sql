-- Re-apply if PGRST202: Could not find public.rosters_for_range(payload).
-- Removes old signatures, creates jsonb payload RPC, grants anon, reloads PostgREST cache.

DROP FUNCTION IF EXISTS public.rosters_for_range (date, date);
DROP FUNCTION IF EXISTS public.rosters_for_range (jsonb);

CREATE OR REPLACE FUNCTION public.rosters_for_range (payload jsonb)
RETURNS TABLE (
  roster_id uuid,
  roster_date date,
  username text,
  start_time time,
  end_time time
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.id,
    r.date,
    u.username,
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

NOTIFY pgrst, 'reload schema';
