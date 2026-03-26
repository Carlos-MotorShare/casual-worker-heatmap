-- Fix login RPC for PostgREST schema cache:
-- recreate the RPC with a jsonb signature and notify PostgREST to reload schema.

DROP FUNCTION IF EXISTS public.login_with_password (payload jsonb);

CREATE OR REPLACE FUNCTION public.login_with_password (payload jsonb)
RETURNS TABLE (id uuid, username text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.username
  FROM public.users u
  WHERE u.password = payload->>'password'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.login_with_password (jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.login_with_password (jsonb) TO anon, authenticated;

-- Force PostgREST to refresh schema cache.
NOTIFY pgrst, 'reload schema';

