-- Expose username + colour for calendar leave markers (users table has no direct PostgREST access).

CREATE OR REPLACE FUNCTION public.staff_colours ()
RETURNS TABLE (
  username text,
  colour text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.username::text,
    u.colour::text
  FROM public.users u;
$$;

REVOKE ALL ON FUNCTION public.staff_colours () FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_colours () TO anon, authenticated;
