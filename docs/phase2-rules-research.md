# Phase 2 rules: research and what went live
Researched 2026-11-11. Every number below is labeled:
- **RESEARCHED**: from the cited source.
- **SPEC**: your number from the build spec, kept because it's a personal choice or more cautious than the source.
- **FROM MEMORY**: not looked up; called out so you can check it.

A rule is **LIVE** only if its threshold is RESEARCHED, or is a SPEC number that's stricter than the researched one, so it can only flag earlier and never later. Anything else is **NOT LIVE** and says what it needs.

These rules produce flags and suggestions. They don't diagnose. Anything medical routes to Dr. Grubbs.

---

## 1. Weight-loss rate → calorie adjustment (LIVE)
- **Target rate:** RESEARCHED: 0.5–1% of body weight per week for best lean-mass retention. Source: Helms, Aragon, Fitschen, *JISSN* 2014;11:20.
  - At 212 lb that's about 1.1–2.1 lb/week.
- **What changed from the spec:** the spec said "<0.5 lb/wk → cut". The research lower bound is 0.5% of body weight, about 1.1 lb at your weight. The live rule uses the researched band.
- **How it measures:** this week's 7-day average weight vs last week's.
- **Data rule:** needs at least 4 weigh-ins in each week. FROM MEMORY: my choice to keep one heavy day from deciding.
- **Trigger:** two weeks in a row below 0.5%/wk → cut 150 cal/day. Two weeks in a row above 1%/wk → add 150 back.
  - SPEC: the 150-cal step size.
- **Limits:** at most one change per 14 days. SPEC: the 1,700 floor is never crossed.

## 2. Lean mass from scans (LIVE, needs scans)
- **Noise floor:** RESEARCHED: whole-body muscle mass on an InBody S10 has a minimal detectable change (95% confidence) of 1.13 kg (about 2.5 lb). A smaller change can be measurement noise. Source: Matsumoto et al., *J Phys Ther Sci* 2025 (PMC11957742).
  - Caveat: that's a different InBody model than Triad's. Same device, same conditions every time.
- **What changed from the spec:** the spec said "lean mass down >1 lb on 2 scans". A 1 lb drop is inside the noise.
- **Live rule:** lean mass down on 2 scans in a row AND down 2.5 lb or more in total → act.
  - SPEC: −200 cal deficit change and +1 set per muscle group.

## 3. Lift progression (increase LIVE, deload NOT LIVE)
- **Increase:** RESEARCHED: add 2–10% load when you can do 1–2 reps more than the target. Source: ACSM Position Stand, Progression Models in Resistance Training (*Med Sci Sports Exerc* 2002;34:364 and 2009;41:687).
  - Live rule: every working set at or above the top of the rep range in each of the last 2 sessions → suggest +2.5–5%, rounded to the nearest 5 lb.
  - SPEC: your "+5–10 lb" sits inside the ACSM 2–10%.
- **Rep ranges:** set per exercise. I seeded them from your 11/9–11/11 notes ("bench 3x6", "chase 12s", "chase 15s"). FROM MEMORY / inferred, so change any with `set_lift_target`.
- **Bench:** SPEC: never below 5 reps.
- **Deload, "missed reps 2 sessions → −10%":** NOT LIVE. I didn't find a source for −10%. It shows as a watch note only, with no number.

## 4. Blood pressure (LIVE, needs readings)
- **Thresholds:** RESEARCHED from the 2025 AHA/ACC High Blood Pressure Guideline (*Hypertension/JACC*, Aug 2025):
  - Stage 1 is 130–139 / 80–89.
  - Target for most adults is under 130/80.
  - Sodium under 2,300 mg/day, ideally under 1,500 mg.
  - For stage 1, lifestyle changes first, then medication if still 130/80 or higher after 3–6 months.
- **Live rule:** the 7-day average is 130 or higher systolic, or 80 or higher diastolic, for 2 weeks in a row. Then:
  - Sodium cap drops from 2,300 to 1,500.
  - Zone 2 is added.
  - Flag for Dr. Grubbs.
- **Data rule:** needs readings on at least 4 days per week. FROM MEMORY: my choice.
- **Default sodium cap:** 2,300 mg. RESEARCHED: same guideline.

## 5. Hematocrit on testosterone (LIVE, lab-driven)
- **Researched thresholds:**
  - Endocrine Society 2018: Hct over 54% → hold therapy and evaluate (hypoxia, sleep apnea). Source: Bhasin et al., *JCEM* 2018.
  - Baseline over 48–50% is a relative contraindication. Sources: AAFP 2024 (*Am Fam Physician* 109:543); Endocrine Society 2010.
- **SPEC:** over 50 → flag; over 52 → act with Grubbs. Both sit earlier than the guideline's 54, so both stay live.
- **Live rule:**
  - Over 50: watch.
  - Over 52: act (call Grubbs).
  - 54 or higher: urgent, the guideline's hold-therapy threshold.
- **Your data:** 2025-03-10 at 51.3, 2026-03-07 at 48.8, 2026-04-15 at 48.6. No flag is current today.

## 6. CPAP (LIVE)
- **Thresholds:** RESEARCHED:
  - CMS adherence is 4+ hours/night on 70% of nights over 30 days. Source: CMS PAP coverage fact sheet (ICN 905064).
  - Residual AHI under 5 is the usual clinical target. Source: sleep-tech study guide (open-exam-prep, BRPT CCSH).
- **Live rules:**
  - AHI over 5 on 3 nights in a row → mask/leak check, call VieMed.
  - Under 4 hours on 3 nights in a row → act.
  - Last 30 nights under 70% compliant (4+ h) → act.
- **What changed from the spec:** "<6 h" isn't backed by any source I found. NOT LIVE as a trigger; hours are still shown.
- **Leak:** NOT LIVE. I didn't find a sourced leak threshold for your ResMed. FROM MEMORY: ResMed uses about 24 L/min as "large leak". Unverified.

## 7. CGM / glucose (LIVE when glucose data exists)
- **Thresholds:** RESEARCHED:
  - Healthy adults without diabetes spend a median of 96% of time at 70–140 mg/dL and 2.1% above 140. Source: Shah et al., *JCEM* 2019;104:4356.
  - Time above 140 of more than 10% has high specificity for dysglycemia. Source: *J Diabetes Sci Technol* 2025, reported by Healio, Jan 2026.
- **Live rules:**
  - Any reading over 140 → flag the meal before it, with the spec's response: swap the meal, protein first, 10-minute walk.
  - A day with more than 10% of readings over 140 → act.
- **"+40 mg/dL spike":** NOT LIVE. I didn't find a source.

## 8. ApoB (NOT LIVE until a target is set)
- **Goals:** RESEARCHED: under 55 / under 70 / under 90 mg/dL for very-high / high / borderline-intermediate risk. Source: 2026 ACC/AHA Dyslipidemia Guideline (Blumenthal et al., *Circulation* 2026), via Healio and HCPLive.
- **Why not live:** your risk category is the cardiologist's call, so there's no default. Set it with `set_setting apob_target`.
  - Once set: latest ApoB above target with a lab at least 90 days after the first ApoB → "statin discussion" flag. SPEC: the 3 months.
- **Also from that guideline:** RESEARCHED: Lp(a) should be measured once in adulthood. It's on your January list.

## 9. Readiness / training call (LIVE)
- **HRV:** RESEARCHED: use a 7-day rolling average of ln(rMSSD) against a baseline band of ±0.5 standard deviations (the "smallest worthwhile change"). Sources:
  - Plews et al.
  - AIS HRV Best Practice Guide.
  - Javaloyes et al. HRV-guided training studies.
- **Live rule:**
  - 7-day average ln(HRV) below baseline (60-day mean) minus 0.5 SD → training call "Zone 2 / no heavy lifting".
  - Otherwise → "Train as planned".
- **What changed from the spec:** the spec said "15% below the 30-day average". That's replaced by the researched band.
- **Resting HR:** practitioner guidance (TrainingPeaks; others) uses 5+ bpm above baseline for 3+ days as a fatigue flag. The evidence is mixed: a 2003 review found 4 studies with no link to overtraining.
  - LIVE as watch only. It doesn't change the training call.
  - Note: propranolol lowers HR, which blunts this signal.

## 10. Alcohol vs next-night HRV and resting HR (LIVE as a report, no cap)
- **Background:** RESEARCHED: alcohol lowers HRV and raises nighttime HR in a dose-dependent way, even at low doses.
  - Pietilä et al., *JMIR Mental Health* 2018, n=4,098.
  - Grosicki et al., *PLOS Digital Health* 2026, n=20,968.
- **Live:** the Sunday review compares your own HRV and resting HR after drink nights vs dry nights over the last 60 days.
  - Drink nights = wine_glasses > 0, or a food item that names a drink (wine, beer, whiskey, port, Guinness, smash, cocktail…).
  - Needs 5+ drink nights.
- **No automatic cap:** you set one with `set_setting wine_weekly_cap` after you see your own numbers. SPEC.

## 11. HDL: tracked only, no rule. SPEC.

## 12. Eye: log each visit (`log_eye`); `get_visit_packet` builds the BP, Hct and CPAP summary to bring. No thresholds.

---

## 13. Last night's sleep → training call (LIVE, added 2026-11-12)
- **Threshold:** RESEARCHED: 6 hours or less of sleep is the cutoff for "acute sleep loss".
  - Craven et al., *Sports Med* 2022;52:2669, meta-analysis of 69 studies. Sleep loss was defined as ≤6 h in 24 h, and control sleep as >6 h. Performance dropped about 7.5% on average, with significant effects in every category, strength included.
  - The same paper found tasks done in the evening were consistently hurt, while morning tasks were largely unaffected.
  - The AASM/SRS consensus (Watson et al., *Sleep* / *JCSM* 2015) says 6 hours or less per night is inadequate for health and safety. Adults should sleep 7+ hours regularly.
- **Two nights in a row:** RESEARCHED: a review of 17 studies found consecutive nights of short sleep reduced force on multi-joint lifts, but not single-joint ones. One night of total deprivation had little effect on strength. Source: Knowles et al., *J Sci Med Sport* 2018;21:959.
- **Live rule:** uses Oura's total sleep time, not time in bed.
  - Last night 6 h or less → "Lift lighter: no top sets or PRs", and lift in the morning if possible.
  - 6 h or less two nights in a row → "Zone 2 only, no heavy lifting".
  - The training call takes the most cautious answer from this rule and rule 9 (HRV).
- **"Under 5 hours":** NOT used as a separate step. I found no source that sets a different cutoff at 5 h; the research cutoff is 6 h.

## Push timing (changed 2026-11-12)
- The push no longer goes out at a fixed 6:30.
- From 6:30 to 9:00 CT, every 15 minutes, the worker re-pulls Oura and CPAP and re-runs the rules. It sends once last night's sleep is in.
- If sleep still isn't in at 9:00, it sends anyway, saying the call ignores last night.
- It never sends twice in a day.

## Calorie target and step bonus
- **Base:** 1,900/day. SPEC: weekly 13,300 ÷ 7. Floor 1,700. SPEC.
- **Adjustments:** rule 1 moves it in 150 steps.
- **Walking burn:** RESEARCHED: the ACSM walking equation gives a net cost of about 0.5 kcal per kg per km on flat ground.
  - The horizontal constant is 0.1 mL O₂/kg/m, at about 5 kcal per litre of O₂. Source: ACSM metabolic equations.
  - A field study found commuter walking costs about 30% more than treadmill. Source: Schantz et al., *Front Public Health* 2022.
- **Steps per km:** FROM MEMORY: about 1,300 (this varies with stride; the same figure is used by calculate.co.nz).
- **Result:** at 96 kg, about 37 kcal net per 1,000 steps. SPEC: half is eaten back, so about 18 kcal per 1,000 steps over the 5,300 baseline.
  - The spec's "40–50 per 1,000" matches the burn, not the bonus.
  - Computed live from your current weight.

## Protein
- 230 g/day. SPEC.
- Helms 2014 recommends 2.3–3.1 g per kg of lean mass. At the 2025 InBody's ~165 lb (75 kg) lean, that's 173–233 g. RESEARCHED. Your 230 is at the top of that range.

## Morning push and Sunday review
- **6:30 CT daily:** training call, calorie target, sodium cap, top watch item. No health numbers other than the targets (spec rule).
- **Sunday 6:30:** a one-line push saying the review is ready. The full review comes from `get_review`.

## Models and numbers added 2026-11-12 (build brief)

| Number | Value | Label |
|---|---|---|
| Can sodium | 95 mg/can | RESEARCHED: Genius Gourmet label, Open Food Facts |
| Imported-history sodium per item | see migrations/0004 | FROM MEMORY estimates, est=1 |
| Weight trend smoothing | Kalman, steady gain 0.1 (q 0.025, r 2.25 lb²) | gain = brief's EWMA alpha 0.1 (SPEC); r = 1.5 lb daily scale noise (FROM MEMORY) |
| Burn window | 21 days, min 14, needs 80% days with food + weight | SPEC (brief 2.2) |
| kcal per lb | 3,500 | SPEC |
| Weekly target | burn − 500, floor 1,700, ±150/week, Sundays | SPEC (brief 2.3) |
| Scorecard BP | < 130/80 | RESEARCHED, same as rule 4 |
| Scorecard sleep | ≥ 7 h | RESEARCHED: AASM/SRS 2015 |
| Scorecard labs | lab's own H/L flag | lab reference range |
| Capacity reminder | 90+ days | SPEC (brief 4.2) |
| Oura scope for VO2 max | heart_health | FROM MEMORY, confirm at re-auth |
| Burn window start | first weigh-in + 7 days | SPEC: Michael 2026-11-12 (diet-start water loss) |
| Target can't rise | until trend weight ≤ goal_weight (blank = never) | SPEC: Michael 2026-11-12 |
| Weekend day cap | ≤ daily target | SPEC: Michael 2026-11-12 |
