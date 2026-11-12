-- The first deploy set a weekly target on a Thursday. Targets are set on Sunday only (brief 2.3).
DELETE FROM model_outputs WHERE model='calorie_target' AND date='2026-11-12';
