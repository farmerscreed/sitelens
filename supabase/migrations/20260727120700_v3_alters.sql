-- M0 · v3 links added to existing v2 tables (PRD.md §16.2)
-- Lets usage/expense/report be measured against BOQ requirement (§10).
ALTER TABLE material_transactions ADD COLUMN building_id UUID REFERENCES buildings(id);
ALTER TABLE material_transactions ADD COLUMN stage_id    UUID REFERENCES type_stages(id);
ALTER TABLE material_transactions ADD COLUMN batch_id    UUID REFERENCES batches(id);
ALTER TABLE expenses              ADD COLUMN building_id UUID REFERENCES buildings(id);
ALTER TABLE daily_reports         ADD COLUMN building_id UUID REFERENCES buildings(id);
