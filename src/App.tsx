import { useState, useMemo, useCallback } from 'react';
import { useTranslation, Trans } from 'react-i18next';
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
import { ResultsSummary } from './components/ResultsSummary';
import './App.css';

type ViewMode = 'landing' | 'single' | 'multi' | 'history';

// Wrapper that strips react-i18next's internal i18nIsDynamicList prop before it reaches the DOM.
function TransLink({ i18nIsDynamicList: _, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { i18nIsDynamicList?: unknown }) {
  return <a {...props} />;
}

function App() {
  const { t, i18n } = useTranslation();
  const [viewMode, setViewMode] = useState<ViewMode>('landing');
  const [activity, setActivity] = useState<ActivitySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [gapModel, setGapModel] = useState<GapModel>('strava');
  const [numSegments, setNumSegments] = useState(10);

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

  const dataQuality: DataQualityReport | null = useMemo(() => {
    if (enrichedRecords.length === 0) return null;
    return assessDataQuality(enrichedRecords);
  }, [enrichedRecords]);

  const sensitivity: SensitivityResult | null = useMemo(() => {
    if (!activity || !driftResult) return null;
    return runSensitivityAnalysis(activity.records, trimStart, trimEnd, gapModel);
  }, [activity, trimStart, trimEnd, gapModel, driftResult]);

  const dfaResult: DFAResult | null = useMemo(() => {
    if (!activity || !activity.hasHRV) return null;
    return analyzeDFAAlpha1(activity.rrIntervals);
  }, [activity]);

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

      const enriched = enrichRecords(parsed.records, gapModel);
      const diag = detectWarmupEndWithDiagnostics(enriched);
      setWarmupDiag(diag);
      setTrimStart(diag.warmupEndSeconds);
      setTrimEnd(parsed.totalDuration);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('app.unknownError'));
      setActivity(null);
    } finally {
      setLoading(false);
    }
  }, [gapModel, t]);

  const handleReset = useCallback(() => {
    setActivity(null);
    setError(null);
    setTrimStart(0);
    setTrimEnd(0);
    setWarmupDiag(null);
    setSaved(false);
    setViewMode('landing');
  }, []);

  const handleSaveToHistory = useCallback(() => {
    if (!activity || !driftResult) return;

    const driftAeT = driftResult.suggestedAeT;
    const dfaAeT = dfaResult?.hrvt1 ?? null;
    const dfaLT = dfaResult?.hrvt2 ?? null;

    let aetHR: number | null = null;
    let method: 'drift' | 'dfa-alpha1' | 'combined' = 'drift';

    if (driftAeT != null && dfaAeT != null) {
      aetHR = Math.round((driftAeT + dfaAeT) / 2);
      method = 'combined';
    } else if (dfaAeT != null) {
      aetHR = dfaAeT;
      method = 'dfa-alpha1';
    } else if (driftAeT != null) {
      aetHR = driftAeT;
      method = 'drift';
    } else {
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

  const toggleLanguage = useCallback(() => {
    i18n.changeLanguage(i18n.language === 'fi' ? 'en' : 'fi');
  }, [i18n]);

  return (
    <div className="app">
      <header>
        <h1 onClick={() => handleReset()} style={{ cursor: 'pointer' }}>{t('app.title')}</h1>
        <p className="subtitle">{t('app.subtitle')}</p>
        <button
          className="lang-toggle"
          onClick={toggleLanguage}
          title={i18n.language === 'fi' ? 'Switch to English' : 'Vaihda suomeksi'}
        >
          {i18n.language === 'fi' ? 'EN' : 'FI'}
        </button>
      </header>

      {viewMode === 'landing' && (
        <>
          <div className="mode-selector">
            <div className="mode-card" onClick={() => setViewMode('landing')}>
              <h3>{t('app.single.title')}</h3>
              <p>{t('app.single.desc')}</p>
              <FileUpload onFileLoaded={handleFileLoaded} loading={loading} />
            </div>
            <div className="mode-card" onClick={() => setViewMode('multi')}>
              <h3>{t('app.multi.title')}</h3>
              <p>{t('app.multi.desc')}</p>
              <div className="mode-card-action">
                {t('app.multi.open')}
              </div>
            </div>
          </div>

          <div className="mode-selector" style={{ gridTemplateColumns: '1fr' }}>
            <div className="mode-card" onClick={() => setViewMode('history')}>
              <h3>{t('app.history.title')}</h3>
              <p>{t('app.history.desc')}</p>
              <div className="mode-card-action">
                {t('app.history.open')}
              </div>
            </div>
          </div>

          {error && <div className="error">{error}</div>}

          <div className="info-box">
            <h3>{t('app.how.title')}</h3>
            <ol>
              <li><strong>{t('app.how.singleTitle')}</strong> {t('app.how.single')}</li>
              <li><strong>{t('app.how.multiTitle')}</strong> {t('app.how.multi')}</li>
              <li><strong>{t('app.how.historyTitle')}</strong> {t('app.how.history')}</li>
            </ol>
            <p>
              <strong>{t('app.how.methodsTitle')}</strong> {t('app.how.methods')}
            </p>
          </div>
        </>
      )}

      {viewMode === 'single' && activity && (
        <>
          <div className="toolbar">
            <button onClick={handleReset} className="btn-reset">{t('common.back')}</button>
            {driftResult && (
              <button
                onClick={handleSaveToHistory}
                className={`btn-save-history ${saved ? 'saved' : ''}`}
                disabled={saved}
              >
                {saved ? t('app.saved') : t('app.save')}
              </button>
            )}
          </div>

          <ResultsSummary hasDFA={!!activity.hasHRV} />

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

          {dfaResult && (
            <DFAPanel
              dfaResult={dfaResult}
              driftAeT={driftResult?.suggestedAeT ?? null}
            />
          )}

          {activity && !activity.hasHRV && (
            <div className="info-box" style={{ marginBottom: '1rem' }}>
              <h3>{t('app.noHrv.title')}</h3>
              <p>{t('app.noHrv.text')}</p>
            </div>
          )}

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
              {t('app.tooFewPoints')}
            </div>
          )}
        </>
      )}

      {viewMode === 'multi' && (
        <MultiFileView onBack={handleReset} />
      )}

      {viewMode === 'history' && (
        <HistoryPanel onBack={handleReset} />
      )}

      <footer>
        <p>
          <Trans
            i18nKey="app.footer"
            components={{
              uphill: <TransLink href="https://uphillathlete.com/aerobic-training/heart-rate-drift/" target="_blank" rel="noopener" />,
              tp: <TransLink href="https://help.trainingpeaks.com/hc/en-us/articles/204071724" target="_blank" rel="noopener" />,
              rogers: <TransLink href="https://pmc.ncbi.nlm.nih.gov/articles/PMC7845545/" target="_blank" rel="noopener" />,
            }}
          />
        </p>
      </footer>
    </div>
  );
}

export default App;
