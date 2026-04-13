import { useState, useMemo, useCallback } from 'react';
import { parseFitFile } from './lib/fitParser';
import type { ActivitySummary } from './lib/fitParser';
import { enrichRecords } from './lib/gapCalculator';
import type { EnrichedRecord, GapModel } from './lib/gapCalculator';
import { analyzeDrift, filterRecords, segmentAnalysis } from './lib/driftAnalysis';
import type { DriftResult, SegmentDrift } from './lib/driftAnalysis';
import { detectWarmupEndWithDiagnostics } from './lib/warmupDetector';
import type { WarmupDiagnostics } from './lib/warmupDetector';
import { assessDataQuality } from './lib/dataQuality';
import type { DataQualityReport } from './lib/dataQuality';
import { runSensitivityAnalysis } from './lib/sensitivityAnalysis';
import type { SensitivityResult } from './lib/sensitivityAnalysis';
import { analyzeDFAAlpha1 } from './lib/dfaAlpha1';
import type { DFAResult } from './lib/dfaAlpha1';
import { compensateForTemperature } from './lib/temperatureCompensation';
import type { TemperatureCompensation } from './lib/temperatureCompensation';
import { saveToHistory } from './lib/historyStore';
import { FileUpload } from './components/FileUpload';
import { ActivityInfo } from './components/ActivityInfo';
import { TrimSelector } from './components/TrimSelector';
import { DriftResultPanel } from './components/DriftResult';
import { Charts } from './components/Charts';
import { DiagnosticsPanel } from './components/DiagnosticsPanel';
import { DFAPanel } from './components/DFAPanel';
import { HistoryPanel } from './components/HistoryPanel';
import { MultiFileView } from './components/MultiFileView';
import './App.css';

type ViewMode = 'landing' | 'single' | 'multi' | 'history';

function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('landing');
  const [activity, setActivity] = useState<ActivitySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [gapModel, setGapModel] = useState<GapModel>('strava');
  const [numSegments, setNumSegments] = useState(10);

  // Diagnostics state
  const [warmupDiag, setWarmupDiag] = useState<WarmupDiagnostics | null>(null);

  const enrichedRecords: EnrichedRecord[] = useMemo(() => {
    if (!activity) return [];
    return enrichRecords(activity.records, gapModel);
  }, [activity, gapModel]);

  const filteredRecords = useMemo(() => {
    return filterRecords(enrichedRecords, trimStart, trimEnd);
  }, [enrichedRecords, trimStart, trimEnd]);

  const driftResult: DriftResult | null = useMemo(() => {
    if (filteredRecords.length < 20) return null;
    try {
      return analyzeDrift(filteredRecords);
    } catch {
      return null;
    }
  }, [filteredRecords]);

  const segments: SegmentDrift[] = useMemo(() => {
    return segmentAnalysis(filteredRecords, numSegments);
  }, [filteredRecords, numSegments]);

  // Data quality assessment
  const dataQuality: DataQualityReport | null = useMemo(() => {
    if (enrichedRecords.length === 0) return null;
    return assessDataQuality(enrichedRecords);
  }, [enrichedRecords]);

  // Sensitivity analysis
  const sensitivity: SensitivityResult | null = useMemo(() => {
    if (!activity || !driftResult) return null;
    return runSensitivityAnalysis(activity.records, trimStart, trimEnd, gapModel);
  }, [activity, trimStart, trimEnd, gapModel, driftResult]);

  // DFA Alpha1 analysis
  const dfaResult: DFAResult | null = useMemo(() => {
    if (!activity || !activity.hasHRV) return null;
    return analyzeDFAAlpha1(activity.rrIntervals);
  }, [activity]);

  // Temperature compensation
  const tempComp: TemperatureCompensation | null = useMemo(() => {
    if (!activity || !driftResult || !activity.hasTemperature) return null;
    const temps = filteredRecords.map(r => r.temperature ?? null);
    const durationMin = (trimEnd - trimStart) / 60;
    return compensateForTemperature(driftResult.gapDecouplingPercent, temps, durationMin);
  }, [activity, driftResult, filteredRecords, trimStart, trimEnd]);

  const handleFileLoaded = useCallback((buffer: ArrayBuffer, fileName: string) => {
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      const parsed = parseFitFile(buffer);
      parsed.name = fileName.replace(/\.fit$/i, '');
      setActivity(parsed);
      setViewMode('single');

      // Auto-detect warmup end with full diagnostics
      const enriched = enrichRecords(parsed.records, gapModel);
      const diag = detectWarmupEndWithDiagnostics(enriched);
      setWarmupDiag(diag);
      setTrimStart(diag.warmupEndSeconds);
      setTrimEnd(parsed.totalDuration);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Tuntematon virhe');
      setActivity(null);
    } finally {
      setLoading(false);
    }
  }, [gapModel]);

  const handleReset = useCallback(() => {
    setActivity(null);
    setError(null);
    setTrimStart(0);
    setTrimEnd(0);
    setWarmupDiag(null);
    setSaved(false);
    setViewMode('landing');
  }, []);

  // Save current analysis to history
  const handleSaveToHistory = useCallback(() => {
    if (!activity || !driftResult) return;

    const driftAeT = driftResult.suggestedAeT;
    const dfaAeT = dfaResult?.hrvt1 ?? null;
    const dfaLT = dfaResult?.hrvt2 ?? null;

    // Use best available estimate
    let aetHR: number | null = null;
    let method: 'drift' | 'dfa-alpha1' | 'combined' = 'drift';

    if (driftAeT != null && dfaAeT != null) {
      // Both available — average them (cross-validated)
      aetHR = Math.round((driftAeT + dfaAeT) / 2);
      method = 'combined';
    } else if (dfaAeT != null) {
      aetHR = dfaAeT;
      method = 'dfa-alpha1';
    } else if (driftAeT != null) {
      aetHR = driftAeT;
      method = 'drift';
    } else {
      // No threshold found, still save the analysis
      aetHR = null;
    }

    const confidence = sensitivity
      ? (sensitivity.robustnessScore >= 75 ? 'high' : sensitivity.robustnessScore >= 50 ? 'medium' : 'low')
      : 'medium';

    saveToHistory({
      date: activity.startTime.toISOString(),
      fileName: activity.name,
      method,
      aetHR,
      ltHR: dfaLT,
      driftPercent: driftResult.gapDecouplingPercent,
      dfaAlpha1: dfaResult?.windows.length ? dfaResult.windows.filter(w => w.isValid).slice(-1)[0]?.alpha1 ?? null : null,
      confidence: confidence as 'high' | 'medium' | 'low',
      temperature: activity.avgTemperature,
      gapModel,
      avgPace: '',
      notes: '',
    });

    setSaved(true);
  }, [activity, driftResult, dfaResult, sensitivity, gapModel]);

  return (
    <div className="app">
      <header>
        <h1 onClick={() => handleReset()} style={{ cursor: 'pointer' }}>Compensated Thresholds</h1>
        <p className="subtitle">Aerobisen kynnyksen analyysi maastojuoksulle</p>
      </header>

      {/* Landing page */}
      {viewMode === 'landing' && (
        <>
          <div className="mode-selector">
            <div className="mode-card" onClick={() => setViewMode('landing')}>
              <h3>Yksittäinen suoritus</h3>
              <p>Analysoi yksi juoksu ja laske drifti</p>
              <FileUpload onFileLoaded={handleFileLoaded} loading={loading} />
            </div>
            <div className="mode-card" onClick={() => setViewMode('multi')}>
              <h3>Monta suoritusta</h3>
              <p>Lataa useita juoksuja ja etsi kynnys automaattisesti</p>
              <div className="mode-card-action">
                Avaa monen suorituksen analyysi →
              </div>
            </div>
          </div>

          <div className="mode-selector" style={{ gridTemplateColumns: '1fr' }}>
            <div className="mode-card" onClick={() => setViewMode('history')}>
              <h3>Seuranta</h3>
              <p>Näe aerobisen kynnyksen kehitys ajan yli</p>
              <div className="mode-card-action">
                Avaa historia →
              </div>
            </div>
          </div>

          {error && <div className="error">{error}</div>}

          <div className="info-box">
            <h3>Miten tämä toimii?</h3>
            <ol>
              <li><strong>Yksittäinen suoritus:</strong> Lataa yksi FIT-tiedosto — sovellus laskee GAP-kompensoidun driftin ja DFA alpha1 -analyysin (jos HRV-data saatavilla)</li>
              <li><strong>Monta suoritusta:</strong> Lataa 3–6 juoksua eri sykealueilta → automaattinen kynnyksen haku</li>
              <li><strong>Seuranta:</strong> Tallenna tulokset ja seuraa AeT:n kehitystä harjoittelun edetessä</li>
            </ol>
            <p>
              <strong>Kaksi itsenäistä menetelmää:</strong> HR-drifti (Pa:Hr decoupling) ja DFA alpha1 (HRV-pohjainen). Kun molemmat ovat saatavilla, ne ristiin validoivat toisensa.
            </p>
          </div>
        </>
      )}

      {/* Single file view */}
      {viewMode === 'single' && activity && (
        <>
          <div className="toolbar">
            <button onClick={handleReset} className="btn-reset">← Takaisin</button>
            {driftResult && (
              <button
                onClick={handleSaveToHistory}
                className={`btn-save-history ${saved ? 'saved' : ''}`}
                disabled={saved}
              >
                {saved ? '✓ Tallennettu' : 'Tallenna historiaan'}
              </button>
            )}
          </div>

          <ActivityInfo activity={activity} />

          <TrimSelector
            totalDuration={activity.totalDuration}
            trimStart={trimStart}
            trimEnd={trimEnd}
            onTrimStartChange={setTrimStart}
            onTrimEndChange={setTrimEnd}
            gapModel={gapModel}
            onGapModelChange={setGapModel}
            numSegments={numSegments}
            onNumSegmentsChange={setNumSegments}
            records={enrichedRecords}
          />

          {driftResult && (
            <DriftResultPanel
              result={driftResult}
              tempComp={tempComp}
            />
          )}

          {/* DFA Alpha1 Panel */}
          {dfaResult && (
            <DFAPanel
              dfaResult={dfaResult}
              driftAeT={driftResult?.suggestedAeT ?? null}
            />
          )}

          {/* No HRV data notice */}
          {activity && !activity.hasHRV && (
            <div className="info-box" style={{ marginBottom: '1rem' }}>
              <h3>DFA Alpha1 ei saatavilla</h3>
              <p>
                Tiedostossa ei ole RR-intervallidataa. DFA alpha1 -analyysi vaatii
                rintasensorin (Polar H10, Garmin HRM-Pro) joka tallentaa beat-to-beat -datan.
                Ota HRV-tallennus käyttöön kellossasi.
              </p>
            </div>
          )}

          {/* Diagnostics Panel */}
          {dataQuality && warmupDiag && (
            <DiagnosticsPanel
              quality={dataQuality}
              sensitivity={sensitivity}
              warmup={warmupDiag}
              trimStart={trimStart}
            />
          )}

          {filteredRecords.length > 0 && (
            <Charts
              records={enrichedRecords}
              segments={segments}
              trimStart={trimStart}
              trimEnd={trimEnd}
            />
          )}

          {filteredRecords.length < 20 && (
            <div className="error">
              Liian vähän datapisteitä valitulla aikavälillä. Laajenna analysoitavaa osuutta.
            </div>
          )}
        </>
      )}

      {/* Multi file view */}
      {viewMode === 'multi' && (
        <MultiFileView onBack={handleReset} />
      )}

      {/* History view */}
      {viewMode === 'history' && (
        <HistoryPanel onBack={handleReset} />
      )}

      <footer>
        <p>
          Perustuu <a href="https://uphillathlete.com/aerobic-training/heart-rate-drift/" target="_blank" rel="noopener">
          Uphill Athlete</a> -metodiin, <a href="https://help.trainingpeaks.com/hc/en-us/articles/204071724" target="_blank" rel="noopener">
          TrainingPeaks</a> Pa:Hr-analyysiin ja <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC7845545/" target="_blank" rel="noopener">
          Rogers et al. (2021)</a> DFA alpha1 -tutkimukseen.
        </p>
      </footer>
    </div>
  );
}

export default App;
