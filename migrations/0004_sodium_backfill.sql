-- 1.1 per-item sodium estimates for imported Fuel Log history (2026-10-28 to 2026-11-11).
-- FROM MEMORY: typical restaurant/recipe sodium for the portion described. All set est=1.
-- Only fills NULLs, so anything the coach already corrected is left alone.
UPDATE food SET sodium_mg=400, est=1 WHERE src_key='fuellog:2026-10-28:item:0' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=1800, est=1 WHERE src_key='fuellog:2026-10-28:item:1' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=1400, est=1 WHERE src_key='fuellog:2026-10-28:preset:d' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=0, est=1 WHERE src_key='fuellog:2026-10-29:item:0' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=2400, est=1 WHERE src_key='fuellog:2026-10-29:preset:d' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=100, est=1 WHERE src_key='fuellog:2026-10-30:item:0' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=450, est=1 WHERE src_key='fuellog:2026-10-30:item:1' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=1100, est=1 WHERE src_key='fuellog:2026-10-30:item:2' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=200, est=1 WHERE src_key='fuellog:2026-10-30:item:3' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=15, est=1 WHERE src_key='fuellog:2026-10-30:item:4' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=10, est=1 WHERE src_key='fuellog:2026-10-30:item:5' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=470, est=1 WHERE src_key='fuellog:2026-10-31:item:0' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=470, est=1 WHERE src_key='fuellog:2026-10-31:item:1' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=15, est=1 WHERE src_key='fuellog:2026-10-31:item:2' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=250, est=1 WHERE src_key='fuellog:2026-10-31:item:3' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=1000, est=1 WHERE src_key='fuellog:2026-10-31:item:4' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=30, est=1 WHERE src_key='fuellog:2026-10-31:item:5' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=2400, est=1 WHERE src_key='fuellog:2026-10-31:preset:l' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=250, est=1 WHERE src_key='fuellog:2026-11-01:item:0' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=1400, est=1 WHERE src_key='fuellog:2026-11-01:item:1' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=5, est=1 WHERE src_key='fuellog:2026-11-01:item:2' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=2100, est=1 WHERE src_key='fuellog:2026-11-01:item:3' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=170, est=1 WHERE src_key='fuellog:2026-11-01:item:4' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=85, est=1 WHERE src_key='fuellog:2026-11-02:item:0' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=1400, est=1 WHERE src_key='fuellog:2026-11-02:item:1' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=900, est=1 WHERE src_key='fuellog:2026-11-02:item:2' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=5, est=1 WHERE src_key='fuellog:2026-11-02:item:3' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=300, est=1 WHERE src_key='fuellog:2026-11-03:item:0' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=900, est=1 WHERE src_key='fuellog:2026-11-03:item:1' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=900, est=1 WHERE src_key='fuellog:2026-11-03:item:2' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=180, est=1 WHERE src_key='fuellog:2026-11-03:item:3' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=5, est=1 WHERE src_key='fuellog:2026-11-03:item:4' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=700, est=1 WHERE src_key='fuellog:2026-11-03:item:5' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=700, est=1 WHERE src_key='fuellog:2026-11-04:item:0' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=800, est=1 WHERE src_key='fuellog:2026-11-04:item:1' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=900, est=1 WHERE src_key='fuellog:2026-11-04:item:2' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=450, est=1 WHERE src_key='fuellog:2026-11-04:item:3' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=400, est=1 WHERE src_key='fuellog:2026-11-04:item:4' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=200, est=1 WHERE src_key='fuellog:2026-11-04:item:5' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=400, est=1 WHERE src_key='fuellog:2026-11-05:item:0' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=550, est=1 WHERE src_key='fuellog:2026-11-05:item:1' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=550, est=1 WHERE src_key='fuellog:2026-11-05:item:2' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=400, est=1 WHERE src_key='fuellog:2026-11-05:item:3' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=650, est=1 WHERE src_key='fuellog:2026-11-05:item:4' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=350, est=1 WHERE src_key='fuellog:2026-11-05:item:5' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=300, est=1 WHERE src_key='fuellog:2026-11-05:item:6' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=300, est=1 WHERE src_key='fuellog:2026-11-05:item:7' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=900, est=1 WHERE src_key='fuellog:2026-11-05:item:8' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=380, est=1 WHERE src_key='fuellog:2026-11-05:item:9' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=85, est=1 WHERE src_key='fuellog:2026-11-06:item:0' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=850, est=1 WHERE src_key='fuellog:2026-11-06:item:1' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=1500, est=1 WHERE src_key='fuellog:2026-11-06:item:2' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=1000, est=1 WHERE src_key='fuellog:2026-11-06:item:3' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=600, est=1 WHERE src_key='fuellog:2026-11-06:item:4' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=250, est=1 WHERE src_key='fuellog:2026-11-06:item:5' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=350, est=1 WHERE src_key='fuellog:2026-11-06:item:6' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=900, est=1 WHERE src_key='fuellog:2026-11-07:item:0' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=450, est=1 WHERE src_key='fuellog:2026-11-07:item:1' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=340, est=1 WHERE src_key='fuellog:2026-11-07:item:2' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=500, est=1 WHERE src_key='fuellog:2026-11-07:item:3' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=500, est=1 WHERE src_key='fuellog:2026-11-07:item:4' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=450, est=1 WHERE src_key='fuellog:2026-11-07:item:5' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=450, est=1 WHERE src_key='fuellog:2026-11-08:item:0' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=250, est=1 WHERE src_key='fuellog:2026-11-08:item:1' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=1100, est=1 WHERE src_key='fuellog:2026-11-08:item:2' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=400, est=1 WHERE src_key='fuellog:2026-11-08:item:3' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=500, est=1 WHERE src_key='fuellog:2026-11-08:item:4' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=2000, est=1 WHERE src_key='fuellog:2026-11-09:item:0' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=180, est=1 WHERE src_key='fuellog:2026-11-09:item:1' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=440, est=1 WHERE src_key='fuellog:2026-11-09:item:2' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=5, est=1 WHERE src_key='fuellog:2026-11-09:item:3' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=450, est=1 WHERE src_key='fuellog:2026-11-10:item:0' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=500, est=1 WHERE src_key='fuellog:2026-11-10:item:1' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=500, est=1 WHERE src_key='fuellog:2026-11-10:item:2' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=1600, est=1 WHERE src_key='fuellog:2026-11-10:item:3' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=700, est=1 WHERE src_key='fuellog:2026-11-10:item:4' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=1500, est=1 WHERE src_key='fuellog:2026-11-11:item:0' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=900, est=1 WHERE src_key='fuellog:2026-11-11:item:1' AND sodium_mg IS NULL
;
UPDATE food SET sodium_mg=150, est=1 WHERE src_key='fuellog:2026-11-11:item:2' AND sodium_mg IS NULL
;
