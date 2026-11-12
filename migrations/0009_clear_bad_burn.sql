-- Burn estimates made before the skip-first-week rule (window started at the 10-28 water-loss week).
DELETE FROM model_outputs WHERE model='expenditure' AND version='exp-1' AND date<='2026-11-12';
