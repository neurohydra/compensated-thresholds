# Compensated Thresholds — AI Documentation

## Purpose & Motivation

This is a browser-based web application for determining **aerobic threshold (AeT)** and **lactate threshold (LT2)** from outdoor running data. The core innovation is **Grade Adjusted Pace (GAP) compensation**, which enables threshold testing on hilly terrain rather than requiring a treadmill or flat course.

Traditional heart rate drift testing (Uphill Athlete / TrainingPeaks method) only works on flat terrain because hills distort the pace-to-HR relationship. This app compensates for elevation changes by converting actual speed to equivalent flat-ground speed using GAP models, making drift analysis valid for trail and mountain runners.

### Why This Exists

- Trail/mountain runners cannot easily do flat steady-state tests
- Existing tools (TrainingPeaks, Runalyze) do not apply GAP compensation to drift analysis
- Two independent threshold detection methods (HR drift + DFA alpha1) provide cross-validation
- Longitudinal tracking helps monitor aerobic fitness changes over training cycles

---

## Core Methodology

### 1. Heart Rate Drift / Pa:Hr Decoupling

Based on Joe Friel's method (TrainingPeaks Pa:Hr analysis):

1. Take a steady-state run of 40-60+ minutes
2. Split the analyzed portion into two equal halves by time
3. Calculate **Efficiency Factor** (EF = speed / heart rate) for each half
4. **Decoupling** = ((EF_first - EF_second) / EF_first) * 100

Interpretation:
- **< 3.5%** → below aerobic threshold (AeT)
- **3.5–5%** → approximately at AeT
- **> 5%** → above AeT

The key enhancement: speed is replaced by **GAP-adjusted speed** before calculating EF, removing terrain effects from the analysis.

### 2. Grade Adjusted Pace (GAP)

Converts actual running speed to equivalent flat-ground effort. Two models available:

- **Strava model** (default, recommended): Empirically derived from millions of Strava activities. HR-correlated cost factors across gradient range.
- **Minetti model** (2002): Lab-derived metabolic cost curve. More conservative, based on oxygen consumption measurements.

Pipeline: raw altitude → 10-point moving average smoothing → gradient calculation → 15-point gradient smoothing → cost factor application to speed.

### 3. DFA Alpha1 (Detrended Fluctuation Analysis)

An independent, HRV-based threshold detection method (Rogers et al. 2021, PMC7845545, r=0.97 vs lab gas exchange):

- Analyzes beat-to-beat (RR interval) heart rate variability
- Rolling 120-second windows, advanced by 5 seconds
- Box sizes 4-16 for short-term scaling exponent
- **α1 = 0.75** corresponds to **HRVT1 / AeT / VT1**
- **α1 = 0.50** corresponds to **HRVT2 / LT2 / VT2**

Requires a chest-strap heart rate monitor (Polar H10, Garmin HRM-Pro) that records beat-to-beat data. Optical wrist sensors do not provide sufficient accuracy.

**Important finding from development**: The drift-based AeT and DFA-based HRVT1 should correspond to the same physiological threshold (first ventilatory threshold). However, if the test effort is too intense, the drift result may actually correspond to HRVT2/LT2 instead. Cross-validation between both methods catches this.

### 4. Temperature Compensation

Cardiovascular drift is affected by ambient temperature:
- Reference temperature: 15°C
- ~0.5% additional drift per °C above reference
- Duration-scaled (base 45 minutes)
- Cold stress compensation below -5°C at 0.2%/°C
- Also accounts for temperature rise during the run

### 5. Multi-File Threshold Estimation

Load 3-6 runs at different heart rate intensities. The app:
1. Auto-detects warmup and analyzes drift for each
2. Sorts by average test HR
3. Finds where drift crosses the 3.5-5% AeT range
4. Uses linear interpolation between bracketing activities
5. Reports confidence based on HR gap between activities

---

## Architecture

### Tech Stack

- **React** (Vite) — single-page application, no backend
- **TypeScript** — full type safety
- **Chart.js** (react-chartjs-2) — all visualizations
- **@garmin/fitsdk** — FIT binary file parsing
- **localStorage** — history persistence (no server needed)

### File Structure

```
src/
├── App.tsx                          # Main app, view routing, state management
├── App.css                          # All styles
├── lib/
│   ├── fitParser.ts                 # FIT file parsing (records, HRV, temperature, power)
│   ├── gapCalculator.ts             # Grade Adjusted Pace (Strava + Minetti models)
│   ├── driftAnalysis.ts             # Core drift/decoupling calculation
│   ├── warmupDetector.ts            # Multi-signal automatic warmup detection
│   ├── dfaAlpha1.ts                 # DFA alpha1 HRV analysis engine
│   ├── dataQuality.ts              # 7 automated data quality checks
│   ├── sensitivityAnalysis.ts      # 4 sensitivity analyses + bootstrap CI
│   ├── temperatureCompensation.ts  # Heat/cold drift compensation
│   ├── historyStore.ts             # localStorage CRUD for longitudinal tracking
│   └── multiAnalysis.ts            # Multi-file orchestration
├── components/
│   ├── FileUpload.tsx               # Drag-and-drop FIT upload
│   ├── ActivityInfo.tsx             # Activity metadata display
│   ├── TrimSelector.tsx             # Trim controls + interactive HR chart + zoom
│   ├── DriftResult.tsx              # Drift analysis results panel
│   ├── Charts.tsx                   # HR+GAP, elevation, segment EF, segment HR charts
│   ├── DiagnosticsPanel.tsx         # Quality, sensitivity, warmup diagnostics
│   ├── DFAPanel.tsx                 # DFA alpha1 results + charts
│   ├── HistoryPanel.tsx             # Longitudinal threshold tracking
│   └── MultiFileView.tsx            # Multi-file analysis view
```

### Data Flow

```
FIT file (binary)
  → fitParser.ts: parse records, HRV (RR intervals), temperature, session data
    → gapCalculator.ts: enrich with grade, GAP speed, cost factor
      → warmupDetector.ts: auto-detect warmup end (3-signal: HR rate + HR std + speed CV)
        → driftAnalysis.ts: filter by trim, split halves, calculate EF decoupling
        → dfaAlpha1.ts: RR intervals → artifact correction → windowed DFA → threshold crossing
        → dataQuality.ts: 7 quality checks → score 0-100
        → sensitivityAnalysis.ts: warmup/split/model/bootstrap sensitivity
        → temperatureCompensation.ts: adjust drift for ambient temperature
```

### Key Interfaces

```typescript
// From fitParser.ts
interface ActivitySummary {
  records: FitRecord[];
  rrIntervals: RRInterval[];
  startTime: Date;
  totalDuration: number;
  totalDistance: number;
  avgHeartRate: number;
  hasHRV: boolean;
  hasTemperature: boolean;
  hasPower: boolean;
  avgTemperature: number | null;
  // ... more fields
}

// From gapCalculator.ts
interface EnrichedRecord extends FitRecord {
  grade: number;
  gapSpeed: number;
  costFactor: number;
  smoothedAltitude: number;
  elapsedSeconds: number;
}

// From driftAnalysis.ts
interface DriftResult {
  rawDecouplingPercent: number;
  gapDecouplingPercent: number;
  interpretation: 'below' | 'at' | 'above';
  suggestedAeT: number | null;
  firstHalf: HalfStats;
  secondHalf: HalfStats;
}

// From dfaAlpha1.ts
interface DFAResult {
  windows: DFAWindow[];
  hrvt1: number | null;        // HR at α1 = 0.75 (AeT)
  hrvt2: number | null;        // HR at α1 = 0.50 (LT2)
  hrvt1Time: number | null;
  isReliable: boolean;
  quality: DFAQuality;
}
```

---

## Analysis Pipeline Details

### Warmup Detection

Multi-signal approach (not a simple fixed-time cutoff):

1. **HR rate of change** (weight 0.4): bpm/min within 60-second windows. Stable when < 2.0 bpm/min.
2. **HR standard deviation** (weight 0.3): Within-window variability. Stable when < 5.0 bpm.
3. **Speed coefficient of variation** (weight 0.3): Pace consistency. Stable when CV < 0.25.

Combined into weighted stability score. Warmup ends when score stays stable for 3 consecutive windows. Post-validation prevents false positives (checks HR doesn't spike >8 bpm in the next 3 windows).

Constraints: minimum 2 minutes, maximum 20 minutes warmup.

### DFA Alpha1 Implementation

1. Extract RR intervals from FIT (three source types: rawBbiMesgs > hrvMesgs > beatIntervalsMesgs)
2. Artifact detection: physiological range (300-2000ms), successive difference (>32.5% increase / >24.5% decrease), local median (>20% deviation)
3. Artifact correction via **linear interpolation** (NOT deletion — deletion inflates alpha1)
4. 120-second rolling windows, max 5% artifact rate per window
5. Integration: cumulative sum of deviations from mean
6. Box-wise linear detrending (sizes 4-16)
7. RMS fluctuation per box size
8. Log-log regression slope = alpha1
9. 5-point moving average smoothing of alpha1 values
10. Threshold crossing: interpolated HR at α1 = 0.75 and α1 = 0.50

### Data Quality Checks (7 total)

1. HR completeness (% of records with valid HR)
2. HR plausibility (30-220 bpm range)
3. HR spike detection (>20 bpm/s changes)
4. Speed plausibility (<8 m/s)
5. GPS altitude quality (reasonable range/variation)
6. Sampling rate consistency
7. Terrain balance between halves (grade distribution similarity)

Overall score 0-100, with individual pass/fail for each check.

### Sensitivity Analysis (4 types)

1. **Warmup sensitivity**: Varies trim start from 0 to 20 minutes in 30-second steps
2. **GAP model comparison**: Strava vs Minetti vs raw (no compensation)
3. **Split sensitivity**: Varies the half-split point from 30% to 70% in 5% steps
4. **Bootstrap CI**: 200 iterations, 60-second block resampling (preserves temporal autocorrelation), 90% confidence interval

Robustness score 0-100: warmup sensitivity 30%, split sensitivity 20%, model agreement 20%, CI width 30%.

---

## UI Features

### View Modes

1. **Landing**: Choose between single file, multi-file, or history view
2. **Single file analysis**: Full analysis pipeline with all panels
3. **Multi-file analysis**: Load multiple runs, automatic threshold estimation
4. **History**: Longitudinal tracking of threshold changes

### TrimSelector

Interactive HR chart (Chart.js) with:
- Selection overlay showing warmup/analyzed regions
- Configurable y-axis zoom: Auto, Tight (selected region), Full (all data), Custom (manual min/max)
- Percentile-based bounds (2nd-98th) to handle outlier HR values
- Trim start/end range sliders
- GAP model and segment count selectors

### Cross-Validation

When both drift and DFA results are available:
- Side-by-side comparison of AeT estimates
- Agreement rating: excellent (≤3 bpm), good (≤6), fair (≤10), poor (>10)
- Combined estimate (average of both methods) for history storage

---

## Critical Design Decisions

1. **GAP before drift calculation**: Grade compensation must happen before splitting into halves, not after. Otherwise, a run with climbs in the first half and descents in the second would show artificial drift.

2. **Interpolation not deletion for artifacts**: Deleting artifact RR intervals shifts the time series and inflates DFA alpha1 values. Linear interpolation preserves temporal structure.

3. **Block bootstrap for CI**: Standard bootstrap would destroy the temporal autocorrelation in physiological data. 60-second block resampling preserves within-block patterns.

4. **Multi-signal warmup detection**: Single-signal (HR-only) detection fails on hills where HR spikes from effort changes, not warmup. Adding speed CV and HR variability signals prevents false positives.

5. **Percentile-based chart bounds**: Using min/max for y-axis causes a single outlier HR reading to compress the entire chart. 2nd-98th percentile ignores outliers while showing the real HR pattern.

6. **No backend required**: Everything runs client-side (FIT parsing, analysis, storage). This simplifies deployment and avoids privacy concerns with uploading workout data.

---

## Language Notes

The UI is in **Finnish** (the user's language). Key terms:
- Syke = Heart rate
- Lämmittely = Warmup
- Analysoitava osuus = Analyzed section
- Sykealue = Heart rate range
- Aerobinen kynnys = Aerobic threshold
- Suoritus = Activity/workout
- Segmentti = Segment
- Datan laatu = Data quality
- Seuranta = Tracking/monitoring

---

## References

- **Uphill Athlete**: Heart rate drift test methodology — uphillathlete.com/aerobic-training/heart-rate-drift/
- **TrainingPeaks**: Pa:Hr decoupling analysis — help.trainingpeaks.com/hc/en-us/articles/204071724
- **Rogers et al. (2021)**: DFA alpha1 validation study — PMC7845545 (r=0.97 vs gas exchange)
- **Minetti et al. (2002)**: Metabolic cost of gradient running — lab-derived cost curves
- **Strava (2017)**: Grade Adjusted Pace — empirical HR-correlated model from activity data

---

## Future Development Ideas

- **Garmin Connect / Strava API integration**: Direct activity selection without manual FIT export. Options: Strava OAuth (easier, no HRV data) vs Garmin Connect proxy (harder, full FIT with HRV).
- **Power (Stryd) support**: FIT parser already extracts power; could add power-based threshold analysis.
- **Pace zone recommendations**: Derive training zones from detected thresholds.
- **Export reports**: PDF/image export of analysis results.
