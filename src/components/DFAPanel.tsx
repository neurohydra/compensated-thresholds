import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
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
  driftAeT: number | null;
}

export function DFAPanel({ dfaResult, driftAeT }: DFAPanelProps) {
  const { t } = useTranslation();

  if (!dfaResult.isReliable && dfaResult.windows.length === 0) {
    return (
      <div className="dfa-panel">
        <h2>{t('dfa.heading')}</h2>
        <div className="dfa-no-data">
          <p>{dfaResult.quality.recommendation}</p>
          <p className="text-muted">{t('dfa.noData.hint')}</p>
        </div>
      </div>
    );
  }

  const validWindows = dfaResult.windows.filter(w => w.isValid);

  return (
    <div className="dfa-panel">
      <h2>{t('dfa.heading')}</h2>

      <div className="dfa-thresholds">
        {dfaResult.hrvt1 != null && (
          <div className="dfa-threshold-card dfa-aet">
            <span className="label">{t('dfa.hrv1.label')}</span>
            <span className="big-value">{dfaResult.hrvt1} <small>{t('common.bpm')}</small></span>
            <span className="sub">{t('dfa.hrv1.sub')}</span>
          </div>
        )}
        {dfaResult.hrvt2 != null && (
          <div className="dfa-threshold-card dfa-lt">
            <span className="label">{t('dfa.hrv2.label')}</span>
            <span className="big-value">{dfaResult.hrvt2} <small>{t('common.bpm')}</small></span>
            <span className="sub">{t('dfa.hrv2.sub')}</span>
          </div>
        )}
        {driftAeT != null && dfaResult.hrvt1 != null && (
          <div className="dfa-threshold-card dfa-compare">
            <span className="label">{t('dfa.crossVal')}</span>
            <CrossValidation driftAeT={driftAeT} dfaAeT={dfaResult.hrvt1} t={t} />
          </div>
        )}
      </div>

      {!dfaResult.isReliable && (
        <div className="dfa-warning">
          ⚠ {dfaResult.quality.recommendation}
        </div>
      )}

      {validWindows.length >= 5 && (
        <DFATimeChart windows={dfaResult.windows} hrvt1Time={dfaResult.hrvt1Time} />
      )}

      {validWindows.length >= 5 && (
        <DFAvsHRChart
          windows={dfaResult.windows}
          hrvt1={dfaResult.hrvt1}
          hrvt2={dfaResult.hrvt2}
        />
      )}

      <div className="dfa-quality">
        <h4>{t('dfa.quality.heading')}</h4>
        <div className="dfa-quality-grid">
          <div><span className="label">{t('dfa.quality.sensor')}</span><span className="value">{sensorLabel(dfaResult.quality.sensorType, t)}</span></div>
          <div><span className="label">{t('dfa.quality.beats')}</span><span className="value">{dfaResult.quality.totalBeats.toLocaleString()}</span></div>
          <div><span className="label">{t('dfa.quality.validWindows')}</span><span className="value">{dfaResult.quality.validWindows} / {dfaResult.quality.totalWindows}</span></div>
          <div><span className="label">{t('dfa.quality.avgArtifacts')}</span><span className="value">{dfaResult.quality.avgArtifactPercent.toFixed(1)}%</span></div>
        </div>
      </div>
    </div>
  );
}

function CrossValidation({ driftAeT, dfaAeT, t }: { driftAeT: number; dfaAeT: number; t: TFunction }) {
  const diff = Math.abs(driftAeT - dfaAeT);
  const agreement = diff <= 3 ? 'excellent' : diff <= 6 ? 'good' : diff <= 10 ? 'fair' : 'poor';

  const classes = {
    excellent: 'cv-excellent',
    good: 'cv-good',
    fair: 'cv-fair',
    poor: 'cv-poor',
  };

  return (
    <div className={`cross-validation ${classes[agreement]}`}>
      <span className="cv-label">{t(`dfa.cv.${agreement}`)}</span>
      <span className="cv-detail">
        {t('dfa.cv.detail', { drift: driftAeT, dfa: dfaAeT, diff })}
      </span>
    </div>
  );
}

function DFATimeChart({ windows }: {
  windows: { elapsedSeconds: number; alpha1: number; isValid: boolean }[];
  hrvt1Time: number | null;
}) {
  const { t } = useTranslation();
  const valid = windows.filter(w => w.isValid && !isNaN(w.alpha1));

  const data = useMemo(() => ({
    labels: valid.map(w => formatDuration(w.elapsedSeconds)),
    datasets: [
      {
        label: t('dfa.chart.dfaLabel'),
        data: valid.map(w => w.alpha1),
        borderColor: '#8b5cf6',
        backgroundColor: 'rgba(139, 92, 246, 0.1)',
        borderWidth: 2,
        pointRadius: 0,
        fill: true,
      },
      {
        label: t('dfa.chart.hrvt1Label'),
        data: valid.map(() => 0.75),
        borderColor: 'rgba(16, 185, 129, 0.6)',
        borderWidth: 2,
        borderDash: [8, 4],
        pointRadius: 0,
      },
      {
        label: t('dfa.chart.hrvt2Label'),
        data: valid.map(() => 0.50),
        borderColor: 'rgba(239, 68, 68, 0.6)',
        borderWidth: 2,
        borderDash: [8, 4],
        pointRadius: 0,
      },
    ],
  }), [valid, t]);

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      title: { display: true, text: t('dfa.chart.timeTitle'), font: { size: 14 } },
      legend: { display: true, position: 'bottom' },
    },
    scales: {
      y: {
        title: { display: true, text: t('dfa.chart.dfaAxis') },
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
  const { t } = useTranslation();
  const valid = windows.filter(w => w.isValid && !isNaN(w.alpha1));
  const sorted = [...valid].sort((a, b) => a.heartRate - b.heartRate);

  const data = useMemo(() => {
    const datasets: any[] = [
      {
        label: t('dfa.chart.dfaLabel') + ' vs. ' + t('dfa.chart.hrAxis'),
        data: sorted.map(w => ({ x: w.heartRate, y: w.alpha1 })),
        borderColor: '#8b5cf6',
        backgroundColor: 'rgba(139, 92, 246, 0.3)',
        pointRadius: 2,
        showLine: false,
      },
    ];

    const minHR = Math.min(...sorted.map(w => w.heartRate)) - 5;
    const maxHR = Math.max(...sorted.map(w => w.heartRate)) + 5;

    datasets.push({
      label: t('dfa.chart.aetLine'),
      data: [{ x: minHR, y: 0.75 }, { x: maxHR, y: 0.75 }],
      borderColor: 'rgba(16, 185, 129, 0.6)',
      borderWidth: 2,
      borderDash: [8, 4],
      pointRadius: 0,
      showLine: true,
    });

    datasets.push({
      label: t('dfa.chart.antLine'),
      data: [{ x: minHR, y: 0.50 }, { x: maxHR, y: 0.50 }],
      borderColor: 'rgba(239, 68, 68, 0.6)',
      borderWidth: 2,
      borderDash: [8, 4],
      pointRadius: 0,
      showLine: true,
    });

    if (hrvt1 != null) {
      datasets.push({
        label: t('dfa.chart.hrvt1Line', { hr: hrvt1 }),
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
        label: t('dfa.chart.hrvt2Line', { hr: hrvt2 }),
        data: [{ x: hrvt2, y: 0 }, { x: hrvt2, y: 1.5 }],
        borderColor: 'rgba(239, 68, 68, 0.8)',
        borderWidth: 2,
        borderDash: [4, 4],
        pointRadius: 0,
        showLine: true,
      });
    }

    return { datasets };
  }, [sorted, hrvt1, hrvt2, t]);

  const options: ChartOptions<'scatter'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      title: { display: true, text: t('dfa.chart.vsTitle'), font: { size: 14 } },
      legend: { display: true, position: 'bottom' },
    },
    scales: {
      x: { title: { display: true, text: t('dfa.chart.hrAxis') }, type: 'linear' },
      y: { title: { display: true, text: t('dfa.chart.dfaAxis') }, min: 0, max: 1.5 },
    },
  };

  return (
    <div className="chart-container">
      <Line data={data as any} options={options as any} />
    </div>
  );
}

function sensorLabel(type: string, t: TFunction): string {
  switch (type) {
    case 'chest-strap': return t('dfa.sensor.chest');
    case 'optical': return t('dfa.sensor.optical');
    default: return t('dfa.sensor.unknown');
  }
}
