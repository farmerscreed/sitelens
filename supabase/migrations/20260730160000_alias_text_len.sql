-- Fix: material_aliases.alias_text was VARCHAR(200), but real QS descriptions
-- routinely exceed it ("High yield high bond reinforcement bar to BS 4449 and
-- 4461 cut and bend to sizes including tying wire and distance spacer…"), so
-- bootstrap/confirm died with "value too long" the first time a long row was
-- mapped. The full description IS the alias (exact-match memory) — widen to
-- TEXT. The unique index on (org_id, lower(alias_text)) is untouched and fine
-- at these lengths.
ALTER TABLE material_aliases ALTER COLUMN alias_text TYPE TEXT;
