-- Cached stacker payloads from the Cloudflare OCR service.
-- Fresh fetches are stored here and served for 15 minutes before re-fetching.
create table if not exists public.stacker_data (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  data text not null
);

comment on table public.stacker_data is
  'Cached stacker JSON from Cloudflare; latest row served for 15 minutes.';

comment on column public.stacker_data.data is
  'JSON string of reconciled stacker payload: { timestamp, cars: { cars: [...] } }.';

create index if not exists stacker_data_created_at_idx
  on public.stacker_data (created_at desc);

notify pgrst, 'reload schema';
