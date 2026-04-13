import { useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import type { ChartOptions } from 'chart.js';
import { Line } from 'react-chartjs-2';
import type { DFAResult } from '../lib/dfaAlpha1';
import { formatDuration } from '../lib/driftAnalysis';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

interface DFAPanelProps {
  dfaResult: DFAResult;
  /** Drift-based AeT for cross-validation */
  driftAeT: number | null;
}

export function DFAPanel({ dfaResult, driftAeT }: DFAPanelProps) {
  if (!dfaResult.isReliable && dfaResult.windows.length === 0) {
    return (
      <div className="dfa-panel">
        <h2>DFA Alpha1 -analyysi</h2>
        <div className="dfa-no-data">
          <p>{dfaResult.quality.recommendation}</p>
          <p className="text-muted">
            DFA alpha1 vaatii RR-intervallidataa (beat-to-beat). Varmista että käytät
            rintasensoria (esim. Polar H10, Garmin HRM-Pro) ja HRV-tallennus on päällä.
          </p>
        </div>
      </div>
    );
  }

  const validWindows = dfaResult.windows.filter(w => w.isValid);

  return (
    <div className="dfa-panel">
      <h2>DFA Alpha1 -analyysi</h2>

      {/* Threshold estimates */}
      <div className="dfa-thresholds">
        {dfaResult.hrvt1 != null && (
          <div className="dfa-threshold-card dfa-aet">
            <span className="label">HRVT1 (AeT)</span>
            <span className="big-value">{dfaResult.hrvt1} <small>bpm</small></span>
            <span className="sub">DFA α1 = 0.75</span>
          </div>
        )}
        {dfaResult.hrvt2 != null && (
          <div className="dfa-threshold-card dfa-lt">
            <span className="label">HRVT2 (AnT/LT2)</span>
            <span className="big-value">{dfaResult.hrvt2} <small>bpm</small></span>
            <span className="sub">DFA α1 = 0.50</span>
          </div>
        )}
        {driftAeT != null && dfaResult.hrvt1 != null && (
          <div className="dfa-threshold-card dfa-compare">
            <span className="label">Ristiin validointi</span>
            <CrossValidation driftAeT={driftAeT} dfaAeT={dfaResult.hrvt1} />
          </div>
        )}
      </div>

      {!dfaResult.isReliable && (
        <div className="dfa-warning">
          ⚠ {dfaResult.quality.recommendation}
        </div>
      )}

      {/* DFA alpha1 over time chart */}
      {validWindows.length >= 5 && (
        <DFATimeChart windows={dfaResult.windows} hrvt1Time={dfaResult.hrvt1Time} />
      )}

      {/* DFA alpha1 vs HR chart */}
      {validWindows.length >= 5 && (
        <DFAvsHRChart
          windows={dfaResult.windows}
          hrvt1={dfaResult.hrvt1}
          hrvt2={dfaResult.hrvt2}
        />
      )}

      {/* Quality info */}
      <div className="dfa-quality">
        <h4>Datan laatu</h4>
        <div className="dfa-quality-grid">
          <div><span className="label">Sensori</span><span className="value">{sensorLabel(dfaResult.quality.sensorType)}</span></div>
          <div><span className="label">Sykelyöntejä</span><span className="value">{dfaResult.quality.totalBeats.toLocaleString()}</span></div>
          <div><span className="label">Validit ikkunat</span><span className="value">{dfaResult.quality.validWindows} / {dfaResult.quality.totalWindows}</span></div>
          <div><span className="label">Keskim. artefaktit</span><span className="value">{dfaResult.quality.avgArtifactPercent.toFixed(1)}%</span></div>
        </div>
      </div>
    </div>
  );
}

function CrossValidation({ driftAeT, dfaAeT }: { driftAeT: number; dfaAeT: number }) {
  const diff = Math.abs(driftAeT - dfaAeT);
  const agreement = diff <= 3 ? 'excellent' : diff <= 6 ? 'good' : diff <= 10 ? 'fair' : 'poor';

  const labels = {
    excellent: 'Erinomainen yhteneväisyys',
    good: 'Hyvä yhteneväisyys',
    fair: 'Kohtalainen yhteneväisyys',
    poor: 'Heikko yhteneväisyys',
  };

  const classes = {
    excellent: 'cv-excellent',
    good: 'cv-good',
    fair: 'cv-fair',
    poor: 'cv-poor',
  };

  return (
    <div className={`cross-validation ${classes[agreement]}`}>
      <span className="cv-label">{labels[agreement]}</span>
      <span className="cv-detail">
        Drifti: {driftAeT} bpm | DFA: {dfaAeT} bpm (ero: {diff} bpm)
      </span>
    </div>
  );
}

function DFATimeChart({ windows, hrvt1Time }: {
  windows: { elapsedSeconds: number; alpha1: number; isValid: boolean }[];
  hrvt1Time: number | null;
}) {
  const valid = windows.filter(w => w.isValid && !isNaN(w.alpha1));

  const data = useMemo(() => ({
    labels: valid.map(w => formatDuration(w.elapsedSeconds)),
    datasets: [
      {
        label: 'DFA α1',
        data: valid.map(w => w.alpha1),
        borderColor: '#8b5cf6',
        backgroundColor: 'rgba(139, 92, 246, 0.1)',
        borderWidth: 2,
        pointRadius: 0,
        fill: true,
      },
      // 0.75 threshold line
      {
        label: 'HRVT1 (0.75)',
        data: valid.map(() => 0.75),
        borderColor: 'rgba(16, 185, 129, 0.6)',
        borderWidth: 2,
        borderDash: [8, 4],
        pointRadius: 0,
      },
      // 0.50 threshold line
      {
        label: 'HRVT2 (0.50)',
        data: valid.map(() => 0.50),
        borderColor: 'rgba(239, 68, 68, 0.6)',
        borderWidth: 2,
        borderDash: [8, 4],
        pointRadius: 0,
      },
    ],
  }), [valid]);

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      title: { display: true, text: 'DFA Alpha1 ajan funktiona', font: { size: 14 } },
      legend: { display: true, position: 'bottom' },
    },
    scales: {
      y: {
        title: { display: true, text: 'DFA α1' },
        min: 0,
        max: 1.5,
      },
    },
  };

  return (
    <div className="chart-container">
      <Line data={data} options={options} />
    </div>
  );
}

function DFAvsHRChart({ windows, hrvt1, hrvt2 }: {
  windows: { heartRate: number; alpha1: number; isValid: boolean }[];
  hrvt1: number | null;
  hrvt2: number | null;
}) {
  const valid = windows.filter(w => w.isValid && !isNaN(w.alpha1));

  // Sort by HR for cleaner visualization
  const sorted = [...valid].sort((a, b) => a.heartRate - b.heartRate);

  const data = useMemo(() => {
    const datasets: any[] = [
      {
        label: 'DFA α1 vs. syke',
        data: sorted.map(w => ({ x: w.heartRate, y: w.alpha1 })),
        borderColor: '#8b5cf6',
        backgroundColor: 'rgba(139, 92, 246, 0.3)',
        pointRadius: 2,
        showLine: false,
      },
    ];

    const minHR = Math.min(...sorted.map(w => w.heartRate)) - 5;
    const maxHR = Math.max(...sorted.map(w => w.heartRate)) + 5;

    // 0.75 line
    datasets.push({
      label: 'AeT (α1=0.75)',
      data: [{ x: minHR, y: 0.75 }, { x: maxHR, y: 0.75 }],
      borderColor: 'rgba(16, 185, 129, 0.6)',
      borderWidth: 2,
      borderDash: [8, 4],
      pointRadius: 0,
      showLine: true,
    });

    // 0.50 line
    datasets.push({
      label: 'AnT (α1=0.50)',
      data: [{ x: minHR, y: 0.50 }, { x: maxHR, y: 0.50 }],
      borderColor: 'rgba(239, 68, 68, 0.6)',
      borderWidth: 2,
      borderDash: [8, 4],
      pointRadius: 0,
      showLine: true,
    });

    // HRVT1 vertical line
    if (hrvt1 != null) {
      datasets.push({
        label: `HRVT1: ${hrvt1} bpm`,
        data: [{ x: hrvt1, y: 0 }, { x: hrvt1, y: 1.5 }],
        borderColor: 'rgba(16, 185, 129, 0.8)',
        borderWidth: 2,
        borderDash: [4, 4],
        pointRadius: 0,
        showLine: true,
      });
    }

    if (hrvt2 != null) {
      datasets.push({
        label: `HRVT2: ${hrvt2} bpm`,
        data: [{ x: hrvt2, y: 0 }, { x: hrvt2, y: 1.5 }],
        borderColor: 'rgba(239, 68, 68, 0.8)',
        borderWidth: 2,
        borderDash: [4, 4],
        pointRadius: 0,
        showLine: true,
      });
    }

    return { datasets };
  }, [sorted, hrvt1, hrvt2]);

  const options: ChartOptions<'scatter'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      title: { display: true, text: 'DFA Alpha1 vs. syke — kynnykset', font: { size: 14 } },
      legend: { display: true, position: 'bottom' },
    },
    scales: {
      x: { title: { display: true, text: 'Syke (bpm)' }, type: 'linear' },
      y: { title: { display: true, text: 'DFA α1' }, min: 0, max: 1.5 },
    },
  };

  return (
    <div className="chart-container">
      <Line data={data as any} options={options as any} />
    </div>
  );
}

function sensorLabel(type: string): string {
  switch (type) {
    case 'chest-strap': return 'Rintasensori (hyvä)';
    case 'optical': return 'Optinen (ei riitä DFA:lle)';
    default: return 'Tuntematon';
  }
}
