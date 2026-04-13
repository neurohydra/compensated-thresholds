import { useMemo, useState } from 'react';
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
  const [expanded, setExpanded] = useState(false);

  // Overall status
  const overallScore = sensitivity
    ? Math.round((quality.score + sensitivity.robustnessScore) / 2)
    : quality.score;
  const overallLevel = overallScore >= 75 ? 'good' : overallScore >= 50 ? 'acceptable' : 'poor';
  const overallLabel = {
    good: 'Luotettava analyysi',
    acceptable: 'Kohtalainen luotettavuus',
    poor: 'Heikko luotettavuus',
  }[overallLevel];

  return (
    <div className="diagnostics-panel">
      <div className="diag-header" onClick={() => setExpanded(!expanded)}>
        <div className="diag-header-left">
          <h3>Analyysin luotettavuus</h3>
          <ScoreBadge score={overallScore} label={overallLabel} />
        </div>
        <div className="diag-header-right">
          <span className="diag-toggle">{expanded ? '▲ Piilota' : '▼ Näytä tiedot'}</span>
        </div>
      </div>

      {/* Quick summary always visible */}
      <div className="diag-quick">
        <QuickStat label="Datan laatu" score={quality.score} />
        <QuickStat label="Tulosten robustius" score={sensitivity?.robustnessScore ?? null} />
        <QuickStat label="Lämmittelytunnistus" score={warmupConfidenceScore(warmup)} />
        {sensitivity && (
          <QuickStat
            label="90% luottamusväli"
            text={`${sensitivity.confidenceInterval.lower.toFixed(1)}–${sensitivity.confidenceInterval.upper.toFixed(1)}%`}
          />
        )}
      </div>

      {quality.issues.length > 0 && (
        <div className="diag-issues">
          {quality.issues.map((issue, i) => (
            <div key={i} className="diag-issue">⚠ {issue}</div>
          ))}
        </div>
      )}

      {expanded && (
        <div className="diag-details">
          {/* Data Quality Checks */}
          <section className="diag-section">
            <h4>Datan laatu</h4>
            <div className="quality-checks">
              {quality.checks.map((check, i) => (
                <div key={i} className={`quality-check ${check.passed ? 'check-pass' : 'check-fail'}`}>
                  <span className="check-icon">{check.passed ? '✓' : '✗'}</span>
                  <span className="check-name">{check.name}</span>
                  <span className="check-score">{check.score}/100</span>
                  <span className="check-detail">{check.detail}</span>
                </div>
              ))}
            </div>
            {quality.removedCount > 0 && (
              <p className="diag-note">Poistettu {quality.removedCount} epäloogista datapistettä.</p>
            )}
          </section>

          {/* Warmup Detection */}
          <section className="diag-section">
            <h4>Lämmittelytunnistus</h4>
            <div className="warmup-info">
              <div className="warmup-info-grid">
                <div><span className="label">Menetelmä</span><span className="value">{warmupMethodLabel(warmup.method)}</span></div>
                <div><span className="label">Luottamus</span><span className="value">{warmupConfLabel(warmup.confidence)}</span></div>
                <div><span className="label">Leikkauspiste</span><span className="value">{formatDuration(warmup.warmupEndSeconds)}</span></div>
                {warmup.hrAtEnd > 0 && (
                  <div><span className="label">Syke leikkauspisteessä</span><span className="value">{warmup.hrAtEnd} bpm</span></div>
                )}
              </div>
              <p className="warmup-reason">{warmup.reason}</p>
            </div>

            {warmup.windows.length > 5 && (
              <WarmupChart windows={warmup.windows} detectedAt={warmup.warmupEndSeconds} currentTrim={trimStart} />
            )}
          </section>

          {/* Sensitivity Analysis */}
          {sensitivity && (
            <>
              <section className="diag-section">
                <h4>Herkkyysanalyysi: Lämmittelyleikkaus</h4>
                <p className="diag-note">
                  Kuinka paljon driftitulos muuttuu eri lämmittelyleikkauspisteillä.
                  Vakaa kuvaaja = robusti tulos.
                </p>
                <WarmupSensitivityChart
                  points={sensitivity.warmupSensitivity}
                  currentWarmup={trimStart}
                />
              </section>

              <section className="diag-section">
                <h4>GAP-mallien vertailu</h4>
                <GapModelComparisonView comparison={sensitivity.gapModelComparison} />
              </section>

              <section className="diag-section">
                <h4>Herkkyysanalyysi: Jakopiste</h4>
                <p className="diag-note">
                  Kuinka paljon driftitulos muuttuu kun puoliskojen jakopistettä siirretään.
                  50% = standardi puoliksi jako.
                </p>
                <SplitSensitivityChart points={sensitivity.splitSensitivity} />
              </section>

              <section className="diag-section">
                <h4>Bootstrap-luottamusväli (90%)</h4>
                <ConfidenceIntervalView ci={sensitivity.confidenceInterval} baseDrift={sensitivity.baseResult.gapDecouplingPercent} />
              </section>

              {sensitivity.summary && (
                <div className="diag-summary">
                  <strong>Yhteenveto:</strong> {sensitivity.summary}
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

function warmupMethodLabel(method: string): string {
  switch (method) {
    case 'hr-pace-combined': return 'Syke + vauhti (yhdistetty)';
    case 'hr-only': return 'Pelkkä syke';
    case 'fallback': return 'Varamenetelmä';
    default: return method;
  }
}

function warmupConfLabel(conf: string): string {
  switch (conf) {
    case 'high': return 'Korkea';
    case 'medium': return 'Kohtalainen';
    case 'low': return 'Matala';
    default: return conf;
  }
}

function WarmupChart({ windows, detectedAt, currentTrim }: {
  windows: { time: number; avgHR: number; stabilityScore: number; hrRate: number }[];
  detectedAt: number;
  currentTrim: number;
}) {
  const data = useMemo(() => ({
    labels: windows.map(w => formatDuration(w.time)),
    datasets: [
      {
        label: 'Syke (bpm)',
        data: windows.map(w => w.avgHR),
        borderColor: '#ef4444',
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        borderWidth: 1.5,
        pointRadius: 0,
        fill: true,
        yAxisID: 'y',
      },
      {
        label: 'Stabiilius',
        data: windows.map(w => w.stabilityScore),
        borderColor: '#8b5cf6',
        borderWidth: 1.5,
        pointRadius: 0,
        yAxisID: 'y1',
      },
    ],
  }), [windows]);

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      title: { display: true, text: 'Lämmittelytunnistuksen signaalit', font: { size: 13 } },
      legend: { display: true, position: 'bottom' },
    },
    scales: {
      y: { position: 'left', title: { display: true, text: 'Syke (bpm)' } },
      y1: { position: 'right', title: { display: true, text: 'Stabiilius (pienempi = vakaampi)' }, grid: { drawOnChartArea: false } },
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
  const validPoints = points.filter(p => p.driftPercent != null);

  const data = useMemo(() => ({
    labels: validPoints.map(p => formatDuration(p.warmupSeconds)),
    datasets: [
      {
        label: 'Drifti (%)',
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
  }), [validPoints, currentWarmup]);

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
            return `Drifti: ${p.driftPercent?.toFixed(1)}% | Analysoitu: ${p.analyzedMinutes} min`;
          },
        },
      },
    },
    scales: {
      x: { title: { display: true, text: 'Lämmittelyleikkaus' } },
      y: { title: { display: true, text: 'Drifti (%)' } },
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
  const items = [
    { label: 'Raaka (ei GAP)', value: comparison.rawDrift },
    { label: 'Strava GAP', value: comparison.stravaDrift },
    { label: 'Minetti GAP', value: comparison.minettiDrift },
  ].filter(i => i.value != null);

  const data = useMemo(() => ({
    labels: items.map(i => i.label),
    datasets: [{
      label: 'Drifti (%)',
      data: items.map(i => i.value),
      backgroundColor: items.map((_, idx) =>
        idx === 0 ? 'rgba(107, 114, 128, 0.6)' :
        idx === 1 ? 'rgba(59, 130, 246, 0.6)' :
        'rgba(16, 185, 129, 0.6)'
      ),
      borderWidth: 0,
      borderRadius: 4,
    }],
  }), [items]);

  const options: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: 'y',
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => `${ctx.parsed.x.toFixed(1)}%`,
        },
      },
    },
    scales: {
      x: { title: { display: true, text: 'Drifti (%)' } },
    },
  };

  return (
    <div>
      <div className="chart-container tiny-chart">
        <Bar data={data} options={options} />
      </div>
      <p className="diag-note">
        Mallien välinen ero: <strong>{comparison.difference.toFixed(1)}%</strong>-yksikköä.
        {comparison.difference > 2 ? ' Maasto vaikuttaa tulokseen merkittävästi.' : ' Vähäinen ero — maasto ei juuri vaikuta.'}
      </p>
    </div>
  );
}

function SplitSensitivityChart({ points }: {
  points: { splitRatio: number; driftPercent: number | null }[];
}) {
  const validPoints = points.filter(p => p.driftPercent != null);

  const data = useMemo(() => ({
    labels: validPoints.map(p => `${Math.round(p.splitRatio * 100)}%`),
    datasets: [{
      label: 'Drifti (%)',
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
  }), [validPoints]);

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
    },
    scales: {
      x: { title: { display: true, text: '1. puoliskon osuus' } },
      y: { title: { display: true, text: 'Drifti (%)' } },
    },
  };

  return (
    <div className="chart-container small-chart">
      <Line data={data} options={options} />
    </div>
  );
}

function ConfidenceIntervalView({ ci, baseDrift }: {
  ci: { lower: number; median: number; upper: number; width: number };
  baseDrift: number;
}) {
  if (ci.width === 0) {
    return <p className="diag-note">Liian vähän dataa bootstrap-analyysiin.</p>;
  }

  // Check if the CI crosses the threshold lines
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
          {/* Threshold markers */}
          <div className="ci-threshold" style={{ left: `${(3.5 / Math.max(ci.upper + 2, 10)) * 100}%` }}>
            <span>3.5%</span>
          </div>
          <div className="ci-threshold ci-threshold-high" style={{ left: `${(5.0 / Math.max(ci.upper + 2, 10)) * 100}%` }}>
            <span>5.0%</span>
          </div>
        </div>
      </div>
      <div className="ci-numbers">
        <span>5%: {ci.lower.toFixed(1)}%</span>
        <span>Mediaani: {ci.median.toFixed(1)}%</span>
        <span>95%: {ci.upper.toFixed(1)}%</span>
      </div>
      {crosses35 && (
        <p className="diag-issue">⚠ Luottamusväli ylittää 3.5% rajan — AeT-arvio on epävarma.</p>
      )}
      {crosses50 && (
        <p className="diag-issue">⚠ Luottamusväli ylittää 5% rajan — tulkinta voi vaihdella.</p>
      )}
    </div>
  );
}
