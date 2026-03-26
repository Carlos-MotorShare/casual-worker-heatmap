-- Casual worker roster: users, rosters, roster_blocks
-- Run in Supabase SQL editor or via CLI.

CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  password text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.rosters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rosters_one_per_user_per_day UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS rosters_date_idx ON public.rosters (date);

CREATE TABLE IF NOT EXISTS public.roster_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roster_id uuid NOT NULL REFERENCES public.rosters (id) ON DELETE CASCADE,
  start_time time NOT NULL,
  end_time time NOT NULL,
  CONSTRAINT roster_blocks_end_after_start CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS roster_blocks_roster_id_idx ON public.roster_blocks (roster_id);

-- Login without exposing the users table via PostgREST.
CREATE OR REPLACE FUNCTION public.login_with_password (p_password text)
RETURNS TABLE (id uuid, username text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.username
  FROM public.users u
  WHERE u.password = p_password
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.login_with_password (text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.login_with_password (text) TO anon, authenticated;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rosters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roster_blocks ENABLE ROW LEVEL SECURITY;

-- No direct table access to credentials.
DROP POLICY IF EXISTS "users_no_direct" ON public.users;
CREATE POLICY "users_no_direct" ON public.users FOR ALL USING (false);

-- Reads for calendar.
DROP POLICY IF EXISTS "rosters_read" ON public.rosters;
CREATE POLICY "rosters_read" ON public.rosters FOR SELECT USING (true);

DROP POLICY IF EXISTS "roster_blocks_read" ON public.roster_blocks;
CREATE POLICY "roster_blocks_read" ON public.roster_blocks FOR SELECT USING (true);

-- Writes: applied in 20260326130000_roster_anon_writes.sql (anon key + RLS).

-- Calendar fetch: join users + blocks without exposing the users table to PostgREST embeds.
-- Single jsonb arg avoids PostgREST PGRST202 (two "date" args are ambiguous in the schema cache).
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
