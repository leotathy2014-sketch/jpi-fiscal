create index if not exists monthly_closings_closed_by_idx on public.monthly_closings(closed_by);
create index if not exists monthly_closings_reopened_by_idx on public.monthly_closings(reopened_by);


