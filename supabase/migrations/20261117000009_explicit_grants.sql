-- =====================================================================
-- Migration 9: explicit API grants
-- Works whether or not the Supabase project "automatically exposes new
-- tables". Access is still decided by Row Level Security (enabled on every
-- table in migration 07) and by the permission checks inside functions.
-- =====================================================================

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant select on all tables in schema public to anon;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;

-- Internal tables: no direct API access at all (only via functions)
revoke all on public.rate_limits, public.document_sequences from anon, authenticated;

-- Anonymous visitors never write directly; checkout, payments and newsletter go through the server.
revoke insert, update, delete on all tables in schema public from anon;
