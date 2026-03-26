-- Allow the Supabase anon role to mutate rosters via your backend API (anon key only).
-- Security: anyone with the anon JWT can write; keep the anon key server-side and protect /api/rosters.

DROP POLICY IF EXISTS "rosters_insert_anon" ON public.rosters;
CREATE POLICY "rosters_insert_anon" ON public.rosters FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "rosters_delete_anon" ON public.rosters;
CREATE POLICY "rosters_delete_anon" ON public.rosters FOR DELETE TO anon USING (true);

DROP POLICY IF EXISTS "roster_blocks_insert_anon" ON public.roster_blocks;
CREATE POLICY "roster_blocks_insert_anon" ON public.roster_blocks FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "roster_blocks_delete_anon" ON public.roster_blocks;
CREATE POLICY "roster_blocks_delete_anon" ON public.roster_blocks FOR DELETE TO anon USING (true);
