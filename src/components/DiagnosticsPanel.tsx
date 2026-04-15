import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import type { ChartOptions } from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';
import type { DataQualityReport } from '../lib/dataQuality';
import type { SensitivityResult } from '../lib/sensitivityAnalysis';
import type { WarmupDiagnostics } from '../lib/warmupDetector';
import { formatDuration } from '../lib/driftAnalysis';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, Filler);

interface DiagnosticsPanelProps {
  quality: DataQualityReport;
  sensitivity: SensitivityResult | null;
  warmup: WarmupDiagnostics;
  trimStart: number;
}

export function DiagnosticsPanel({ quality, sensitivity, warmup, trimStart }: DiagnosticsPanelProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const overallScore = sensitivity
    ? Math.round((quality.score + sensitivity.robustnessScore) / 2)
    : quality.score;
  const overallLevel = overallScore >= 75 ? 'good' : overallScore >= 50 ? 'acceptable' : 'poor';
  const overallLabel = t(`diagnostics.status.${overallLevel}`);

  return (
    <div className="diagnostics-panel">
      <div className="diag-header" onClick={() => setExpanded(!expanded)}>
        <div className="diag-header-left">
          <h3>{t('diagnostics.heading')}</h3>
          <ScoreBadge score={overallScore} label={overallLabel} />
        </div>
        <div className="diag-header-right">
          <span className="diag-toggle">{expanded ? t('diagnostics.toggle.hide') : t('diagnostics.toggle.show')}</span>
        </div>
      </div>

      <div className="diag-quick">
        <QuickStat label={t('diagnostics.qs.quality')} score={quality.score} />
        <QuickStat label={t('diagnostics.qs.robustness')} score={sensitivity?.robustnessScore ?? null} />
        <QuickStat label={t('diagnostics.qs.warmup')} score={warmupConfidenceScore(warmup)} />
        {sensitivity && (
          <QuickStat
            label={t('diagnostics.qs.ci')}
            text={`${sensitivity.confidenceInterval.lower.toFixed(1)}–${sensitivity.confidenceInterval.upper.toFixed(1)}%`}
          />
        )}
      </div>

      {quality.issues.length > 0 && (
        <div className="diag-issues">
          {quality.issues.map((issue, i) => (
            <div key={i} className="diag-issue">⚠ {t(issue.key, issue.params)}</div>
          ))}
        </div>
      )}

      {expanded && (
        <div className="diag-details">
          <section className="diag-section">
            <h4>{t('diagnostics.quality.heading')}</h4>
            <div className="quality-checks">
              {quality.checks.map((check, i) => (
                <div key={i} className={`quality-check ${check.passed ? 'check-pass' : 'check-fail'}`}>
                  <span className="check-icon">{check.passed ? '✓' : '✗'}</span>
                  <span className="check-name">{t(check.nameKey)}</span>
                  <span className="check-score">{check.score}/100</span>
                  <span className="check-detail">{t(check.detailKey, check.detailParams)}</span>
                </div>
              ))}
            </div>
            {quality.removedCount > 0 && (
              <p className="diag-note">{t('diagnostics.quality.removed', { count: quality.removedCount })}</p>
            )}
          </section>

          <section className="diag-section">
            <h4>{t('diagnostics.warmup.heading')}</h4>
            <div className="warmup-info">
              <div className="warmup-info-grid">
                <div><span className="label">{t('diagnostics.warmup.method')}</span><span className="value">{warmupMethodLabel(warmup.method, t)}</span></div>
                <div><span className="label">{t('diagnostics.warmup.confidence')}</span><span className="value">{warmupConfLabel(warmup.confidence, t)}</span></div>
                <div><span className="label">{t('diagnostics.warmup.cutoff')}</span><span className="value">{formatDuration(warmup.warmupEndSeconds)}</span></div>
                {warmup.hrAtEnd > 0 && (
                  <div><span className="label">{t('diagnostics.warmup.hrAtCutoff')}</span><span className="value">{warmup.hrAtEnd} {t('common.bpm')}</span></div>
                )}
              </div>
              <p className="warmup-reason">{warmup.reason}</p>
            </div>

            {warmup.windows.length > 5 && (
              <WarmupChart windows={warmup.windows} detectedAt={warmup.warmupEndSeconds} currentTrim={trimStart} />
            )}
          </section>

          {sensitivity && (
            <>
              <section className="diag-section">
                <h4>{t('diagnostics.sens.warmupTitle')}</h4>
                <p className="diag-note">{t('diagnostics.sens.warmupNote')}</p>
                <WarmupSensitivityChart
                  points={sensitivity.warmupSensitivity}
                  currentWarmup={trimStart}
                />
              </section>

              <section className="diag-section">
                <h4>{t('diagnostics.sens.gapTitle')}</h4>
                <GapModelComparisonView comparison={sensitivity.gapModelComparison} />
              </section>

              <section className="diag-section">
                <h4>{t('diagnostics.sens.splitTitle')}</h4>
                <p className="diag-note">{t('diagnostics.sens.splitNote')}</p>
                <SplitSensitivityChart points={sensitivity.splitSensitivity} />
              </section>

              <section className="diag-section">
                <h4>{t('diagnostics.sens.ciTitle')}</h4>
                <ConfidenceIntervalView ci={sensitivity.confidenceInterval} baseDrift={sensitivity.baseResult.gapDecouplingPercent} />
              </section>

              {sensitivity.summaryKeys.length > 0 && (
                <div className="diag-summary">
                  <strong>{t('diagnostics.summary')}</strong>{' '}
                  {sensitivity.summaryKeys.map(s => t(s.key, s.params)).join(' ')}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ScoreBadge({ score, label }: { score: number; label: string }) {
  const cls = score >= 75 ? 'score-good' : score >= 50 ? 'score-ok' : 'score-poor';
  return (
    <span className={`score-badge ${cls}`}>
      {score}/100 — {label}
    </span>
  );
}

function QuickStat({ label, score, text }: { label: string; score?: number | null; text?: string }) {
  if (text) {
    return (
      <div className="quick-stat">
        <span className="qs-label">{label}</span>
        <span className="qs-value">{text}</span>
      </div>
    );
  }
  if (score == null) return null;
  const cls = score >= 75 ? 'qs-good' : score >= 50 ? 'qs-ok' : 'qs-poor';
  return (
    <div className="quick-stat">
      <span className="qs-label">{label}</span>
      <span className={`qs-value ${cls}`}>{score}/100</span>
    </div>
  );
}

function warmupConfidenceScore(w: WarmupDiagnostics): number {
  if (w.confidence === 'high') return 90;
  if (w.confidence === 'medium') return 60;
  return 30;
}

function warmupMethodLabel(method: string, t: TFunction): string {
  switch (method) {
    case 'hr-pace-combined': return t('diagnostics.warmup.methods.hrPace');
    case 'hr-only': return t('diagnostics.warmup.methods.hrOnly');
    case 'fallback': return t('diagnostics.warmup.methods.fallback');
    default: return method;
  }
}

function warmupConfLabel(conf: string, t: TFunction): string {
  switch (conf) {
    case 'high': return t('diagnostics.warmup.conf.high');
    case 'medium': return t('diagnostics.warmup.conf.medium');
    case 'low': return t('diagnostics.warmup.conf.low');
    default: return conf;
  }
}

function WarmupChart({ windows }: {
  windows: { time: number; avgHR: number; stabilityScore: number; hrRate: number }[];
  detectedAt: number;
  currentTrim: number;
}) {
  const { t } = useTranslation();

  const data = useMemo(() => ({
    labels: windows.map(w => formatDuration(w.time)),
    datasets: [
      {
        label: t('diagnostics.warmup.chart.hrLabel'),
        data: windows.map(w => w.avgHR),
        borderColor: '#ef4444',
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        borderWidth: 1.5,
        pointRadius: 0,
        fill: true,
        yAxisID: 'y',
      },
      {
        label: t('diagnostics.warmup.chart.stabilityLabel'),
        data: windows.map(w => w.stabilityScore),
        borderColor: '#8b5cf6',
        borderWidth: 1.5,
        pointRadius: 0,
        yAxisID: 'y1',
      },
    ],
  }), [windows, t]);

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      title: { display: true, text: t('diagnostics.warmup.chart.title'), font: { size: 13 } },
      legend: { display: true, position: 'bottom' },
    },
    scales: {
      y: { position: 'left', title: { display: true, text: t('diagnostics.warmup.chart.hrAxis') } },
      y1: { position: 'right', title: { display: true, text: t('diagnostics.warmup.chart.stabilityAxis') }, grid: { drawOnChartArea: false } },
    },
  };

  return (
    <div className="chart-container small-chart">
      <Line data={data} options={options} />
    </div>
  );
}

function WarmupSensitivityChart({ points, currentWarmup }: {
  points: { warmupSeconds: number; driftPercent: number | null; analyzedMinutes: number }[];
  currentWarmup: number;
}) {
  const { t } = useTranslation();
  const validPoints = points.filter(p => p.driftPercent != null);

  const data = useMemo(() => ({
    labels: validPoints.map(p => formatDuration(p.warmupSeconds)),
    datasets: [
      {
        label: t('common.drift'),
        data: validPoints.map(p => p.driftPercent),
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        borderWidth: 2,
        pointRadius: validPoints.map(p =>
          Math.abs(p.warmupSeconds - currentWarmup) < 15 ? 6 : 2
        ),
        pointBackgroundColor: validPoints.map(p =>
          Math.abs(p.warmupSeconds - currentWarmup) < 15 ? '#f59e0b' : '#3b82f6'
        ),
        fill: true,
      },
    ],
  }), [validPoints, currentWarmup, t]);

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      title: { display: false },
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const p = validPoints[ctx.dataIndex];
            return t('diagnostics.sens.warmupTooltip', { drift: p.driftPercent?.toFixed(1), minutes: p.analyzedMinutes });
          },
        },
      },
    },
    scales: {
      x: { title: { display: true, text: t('diagnostics.sens.warmupXAxis') } },
      y: { title: { display: true, text: t('diagnostics.sens.warmupYAxis') } },
    },
  };

  return (
    <div className="chart-container small-chart">
      <Line data={data} options={options} />
    </div>
  );
}

function GapModelComparisonView({ comparison }: {
  comparison: { stravaDrift: number | null; minettiDrift: number | null; rawDrift: number | null; difference: number };
}) {
  const { t } = useTranslation();

  const items = [
    { label: t('diagnostics.models.raw'), value: comparison.rawDrift },
    { label: t('diagnostics.models.strava'), value: comparison.stravaDrift },
    { label: t('diagnostics.models.minetti'), value: comparison.minettiDrift },
  ].filter(i => i.value != null);

  const data = useMemo(() => ({
    labels: items.map(i => i.label),
    datasets: [{
      label: t('diagnostics.sens.gapXAxis'),
      data: items.map(i => i.value),
      backgroundColor: items.map((_, idx) =>
        idx === 0 ? 'rgba(107, 114, 128, 0.6)' :
        idx === 1 ? 'rgba(59, 130, 246, 0.6)' :
        'rgba(16, 185, 129, 0.6)'
      ),
      borderWidth: 0,
      borderRadius: 4,
    }],
  }), [items, t]);

  const options: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: 'y',
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => `${(ctx.parsed.x ?? 0).toFixed(1)}%`,
        },
      },
    },
    scales: {
      x: { title: { display: true, text: t('diagnostics.sens.gapXAxis') } },
    },
  };

  const noteKey = comparison.difference > 2 ? 'significant' : 'minor';

  return (
    <div>
      <div className="chart-container tiny-chart">
        <Bar data={data} options={options} />
      </div>
      <p className="diag-note">
        {t(`diagnostics.sens.gapNote.${noteKey}`, { diff: comparison.difference.toFixed(1) })}
      </p>
    </div>
  );
}

function SplitSensitivityChart({ points }: {
  points: { splitRatio: number; driftPercent: number | null }[];
}) {
  const { t } = useTranslation();
  const validPoints = points.filter(p => p.driftPercent != null);

  const data = useMemo(() => ({
    labels: validPoints.map(p => `${Math.round(p.splitRatio * 100)}%`),
    datasets: [{
      label: t('common.drift'),
      data: validPoints.map(p => p.driftPercent),
      borderColor: '#10b981',
      backgroundColor: 'rgba(16, 185, 129, 0.1)',
      borderWidth: 2,
      pointRadius: validPoints.map(p =>
        Math.abs(p.splitRatio - 0.5) < 0.01 ? 6 : 2
      ),
      pointBackgroundColor: validPoints.map(p =>
        Math.abs(p.splitRatio - 0.5) < 0.01 ? '#f59e0b' : '#10b981'
      ),
      fill: true,
    }],
  }), [validPoints, t]);

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
    },
    scales: {
      x: { title: { display: true, text: t('diagnostics.sens.splitXAxis') } },
      y: { title: { display: true, text: t('diagnostics.sens.splitYAxis') } },
    },
  };

  return (
    <div className="chart-container small-chart">
      <Line data={data} options={options} />
    </div>
  );
}

function ConfidenceIntervalView({ ci }: {
  ci: { lower: number; median: number; upper: number; width: number };
  baseDrift: number;
}) {
  const { t } = useTranslation();

  if (ci.width === 0) {
    return <p className="diag-note">{t('diagnostics.ci.tooFew')}</p>;
  }

  const crosses35 = ci.lower < 3.5 && ci.upper > 3.5;
  const crosses50 = ci.lower < 5.0 && ci.upper > 5.0;

  return (
    <div className="ci-view">
      <div className="ci-bar-container">
        <div className="ci-bar">
          <div className="ci-range" style={{
            left: `${((ci.lower / Math.max(ci.upper + 2, 10)) * 100)}%`,
            width: `${((ci.width / Math.max(ci.upper + 2, 10)) * 100)}%`,
          }}>
            <div className="ci-median" style={{
              left: `${(((ci.median - ci.lower) / ci.width) * 100)}%`,
            }} />
          </div>
          <div className="ci-threshold" style={{ left: `${(3.5 / Math.max(ci.upper + 2, 10)) * 100}%` }}>
            <span>3.5%</span>
          </div>
          <div className="ci-threshold ci-threshold-high" style={{ left: `${(5.0 / Math.max(ci.upper + 2, 10)) * 100}%` }}>
            <span>5.0%</span>
          </div>
        </div>
      </div>
      <div className="ci-numbers">
        <span>{t('diagnostics.ci.p5', { value: ci.lower.toFixed(1) })}</span>
        <span>{t('diagnostics.ci.median', { value: ci.median.toFixed(1) })}</span>
        <span>{t('diagnostics.ci.p95', { value: ci.upper.toFixed(1) })}</span>
      </div>
      {crosses35 && (
        <p className="diag-issue">{t('diagnostics.ci.warningAeT')}</p>
      )}
      {crosses50 && (
        <p className="diag-issue">{t('diagnostics.ci.warningLT')}</p>
      )}
    </div>
  );
}
