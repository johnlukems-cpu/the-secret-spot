"""Regenerates supabase/setup/*.sql (paste-ready files for the Supabase SQL editor).
Run: python3 scripts/build-setup-sql.py"""
import glob, os
os.chdir(os.path.join(os.path.dirname(__file__), ".."))
hdr = lambda t: f"-- =====================================================================\n-- {t}\n-- Generated from supabase/migrations + seed.sql by scripts/build-setup-sql.py.\n-- Paste the whole file into Supabase → SQL Editor → Run.\n-- =====================================================================\n\n"
parts = [f"-- >>> {os.path.basename(f)}\n" + open(f).read() for f in sorted(glob.glob("supabase/migrations/*.sql"))]
open("supabase/setup/01_schema.sql", "w").write(hdr("STEP 1 – Database schema, business logic & security (run once)") + "\n\n".join(parts))
seed = open("supabase/seed.sql").read()
i = seed.index("-- ---------------------------------------------------------------------\n-- DEMO catalogue")
open("supabase/setup/02_configuration.sql", "w").write(hdr("STEP 2 – Default settings, districts, categories, templates (run once)") + seed[:i])
open("supabase/setup/03_demo_products_optional.sql", "w").write(hdr("STEP 3 (OPTIONAL) – 12 [DEMO] products for testing. Archive them before going live.") + seed[i:])
