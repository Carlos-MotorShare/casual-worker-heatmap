-- Optional JSONB for per-staff leave ranges (mirrors client `staffsAway`).
alter table if exists public.staffing_data
  add column if not exists staffs_away jsonb not null default '[]'::jsonb;

comment on column public.staffing_data.staffs_away is
  'Array of { staffName, startDate, endDate, reason }; sent to clients as staffsAway.';
