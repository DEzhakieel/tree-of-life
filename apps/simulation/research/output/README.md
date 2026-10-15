# Fractal Life — research report

- tool: `fractal-life research harness`
- timestamp: `2026-09-26T08:10:53.769Z`
- node: `v18.12.1` (`win32/x64`)
- package: `@fractal-life/simulation@1.0.0`
- engine sha256: `fbc2b2541731a5cc…`
- git: `n/a (no repo)`
- seeds: 24
- scenarios: first-order, second-order, third-order, conservation, stochastic

## Determinism: first-order

All 3 seeds reproduced identical world fingerprints: **PASS**.

## Determinism: second-order

All 3 seeds reproduced identical world fingerprints: **PASS**.

## Determinism: third-order

All 3 seeds reproduced identical world fingerprints: **PASS**.

## Determinism: stochastic

All 3 seeds reproduced identical world fingerprints: **PASS**.

## first-order

n = 24 seeds, avg 204.1 ms/seed

```json
{
  "gap_mean": 23.308367140398307,
  "gap_sd": 2.5990928314782664,
  "gap_median": 22.035649041284636,
  "gap_ci95": [
    22.302038082059397,
    24.35770030544321
  ],
  "gap_se": 0.5219310335798306,
  "gap_p_permutation": 0.00009999000099990002,
  "gap_cohens_d": 12.682505421699217,
  "gap_effect": "large",
  "gap_frac_positive": 1,
  "gap_positive_ci95": [
    0.8715425118532758,
    0.990481283471744
  ]
}
```

## second-order

n = 24 seeds, avg 4120.7 ms/seed

```json
{
  "completion_rate": 0.9583333333333334,
  "completion_ci95": [
    0.8110363128713187,
    0.9791521661766159
  ],
  "completion_k": 23,
  "completion_n": 24,
  "completion_mean_tick": 1380.0416666666667,
  "completion_median_tick": 1567.5,
  "completion_tick_ci95": [
    1176.065625,
    1576.815625
  ],
  "kills_mean": 1.7083333333333333,
  "kills_median": 2
}
```

## third-order

n = 24 seeds, avg 384.2 ms/seed

```json
{
  "growth_mean": 0.0423736572265625,
  "growth_sd": 0.00030899969262284543,
  "growth_median": 0.0424957275390625,
  "growth_ci95": [
    0.0422356923421224,
    0.042484283447265625
  ],
  "growth_se": 0.00006208924120068437,
  "growth_p_permutation": 0.00009999000099990002,
  "growth_cohens_d": 193.93352863394693,
  "growth_effect": "large",
  "growth_frac_positive": 1,
  "minerals_mean": 10.982695189770311,
  "minerals_sd": 0.08719637292016595,
  "minerals_median": 11.01482081413269,
  "minerals_ci95": [
    10.943786554283967,
    11.014821176727613
  ],
  "minerals_se": 0.017504309755085958,
  "minerals_p_permutation": 0.00009999000099990002,
  "minerals_cohens_d": 178.125258753634,
  "minerals_effect": "large",
  "minerals_frac_positive": 1
}
```

## conservation

n = 24 seeds, avg 89.9 ms/seed

```json
{
  "meat_error_mean": -0.0000015258789062555511,
  "meat_error_ci95": [
    -0.0000015258789062555511,
    -0.0000015258789062555511
  ],
  "meat_error_max_abs": 0.0000015258789062555511,
  "mineral_error_mean": -0.00003999862794687002,
  "mineral_error_ci95": [
    -0.00003999928788592696,
    -0.000039998046122494135
  ],
  "mineral_error_max_abs": 0.000040001422166827116
}
```

## stochastic

n = 24 seeds, avg 14831.6 ms/seed

```json
{
  "alive_mean": 0.08333333333333333,
  "alive_sd": 0.6538625481582946,
  "alive_median": 0,
  "alive_ci95": [
    -0.125,
    0.375
  ],
  "alive_se": 0.12714907495957695,
  "alive_p_permutation": 0.9514048595140486,
  "alive_cohens_d": 0.18023838577343806,
  "alive_effect": "negligible",
  "alive_frac_positive": 0.08333333333333333,
  "energy_mean": 2.791305938961838,
  "energy_sd": 24.50417776738109,
  "energy_median": 1.4743835326566774,
  "energy_ci95": [
    -6.544579132320642,
    12.579614510519642
  ],
  "energy_se": 4.8795637893535515,
  "energy_p_permutation": 0.9371062893710629,
  "energy_cohens_d": 0.16109508970617833,
  "energy_effect": "negligible",
  "energy_frac_positive": 0.625,
  "plasticity_mean": 0.02803003964491718,
  "plasticity_sd": 0.018898599146349185,
  "plasticity_median": 0.032865872624567756,
  "plasticity_ci95": [
    0.02075388278875606,
    0.03516019828926632
  ],
  "plasticity_se": 0.0037473522142234686,
  "plasticity_p_permutation": 0.00039996000399960006,
  "plasticity_cohens_d": 2.097534421081952,
  "plasticity_effect": "large",
  "plasticity_frac_positive": 0.8333333333333334,
  "food_cv_mean": 0.010395809822259966,
  "food_cv_sd": 0.0004729263252389602,
  "food_cv_median": 0.010442620714913808,
  "food_cv_ci95": [
    0.010209503194669636,
    0.010578782265077885
  ],
  "food_cv_se": 0.0000949153692434107,
  "food_cv_p_permutation": 0.16998300169983002,
  "food_cv_cohens_d": 31.087073097618124,
  "food_cv_effect": "large",
  "food_cv_frac_positive": 1,
  "explore_frac_mean": 0.9381944444444444,
  "explore_frac_min": 0.21666666666666667,
  "explore_frac_max": 1,
  "weather_frac_mean": 0.49282407407407397,
  "weather_frac_min": 0.3055555555555556,
  "weather_frac_max": 0.7111111111111111
}
```

## Total

518280 ms
