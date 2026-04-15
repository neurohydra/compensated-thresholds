import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
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
import { Scatter } from 'react-chartjs-2';
import { parseFitFile } from '../lib/fitParser';
import { createAnalyzedActivity, reanalyzeActivity, runMultiAnalysis } from '../lib/multiAnalysis';
import type { AnalyzedActivity, ThresholdEstimate } from '../lib/multiAnalysis';
import { formatDuration } from '../lib/driftAnalysis';
import type { GapModel } from '../lib/gapCalculator';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

interface MultiFileViewProps {
  onBack: () => void;
}

export function MultiFileView({ onBack }: MultiFileViewProps) {
  const { t } = useTranslation();
  const [activities, setActivities] = useState<AnalyzedActivity[]>([]);
  const [gapModel, setGapModel] = useState<GapModel>('strava');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const handleFiles = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setLoading(true);
    setError(null);

    const newActivities: AnalyzedActivity[] = [];

    for (let i = 0; i < files.length; i++) {
      try {
        const buffer = await files[i].arrayBuffer();
        const parsed = parseFitFile(buffer);
        parsed.name = files[i].name.replace(/\.fit$/i, '');
        const analyzed = createAnalyzedActivity(
          parsed,
          files[i].name,
          gapModel,
          activities.length + newActivities.length,
        );
        newActivities.push(analyzed);
      } catch (err) {
        setError(t('multi.errorInFile', { file: files[i].name, error: err instanceof Error ? err.message : t('app.unknownError') }));
      }
    }

    setActivities(prev => [...prev, ...newActivities]);
    setLoading(false);
    e.target.value = '';
  }, [activities.length, gapModel, t]);

  const handleRemove = useCallback((id: string) => {
    setActivities(prev => prev.filter(a => a.id !== id));
  }, []);

  const handleTrimChange = useCallback((id: string, trimStart: number, trimEnd: number) => {
    setActivities(prev => prev.map(a =>
      a.id === id ? reanalyzeActivity(a, trimStart, trimEnd, gapModel) : a
    ));
  }, [gapModel]);

  const analysis = useMemo(() => runMultiAnalysis(activities), [activities]);

  return (
    <div className="multi-view">
      <div className="toolbar">
        <button onClick={onBack} className="btn-reset">{t('multi.back')}</button>
      </div>

      <div className="multi-header">
        <h2>{t('multi.heading')}</h2>
        <p className="text-muted">{t('multi.desc')}</p>
      </div>

      <div className="multi-upload">
        <label className="upload-btn">
          {t('multi.addFiles')}
          <input
            type="file"
            accept=".fit,.FIT"
            multiple
            onChange={handleFiles}
            disabled={loading}
            style={{ display: 'none' }}
          />
        </label>
        <div className="setting">
          <label>{t('multi.gapModel')}</label>
          <select value={gapModel} onChange={e => setGapModel(e.target.value as GapModel)}>
            <option value="strava">{t('multi.strava')}</option>
            <option value="minetti">{t('multi.minetti')}</option>
          </select>
        </div>
        {loading && <span className="spinner" />}
      </div>

      {error && <div className="error">{error}</div>}

      {activities.length > 0 && (
        <div className="activity-list">
          <table>
            <thead>
              <tr>
                <th></th>
                <th>{t('multi.table.day')}</th>
                <th>{t('multi.table.file')}</th>
                <th>{t('multi.table.warmup')}</th>
                <th>{t('multi.table.analyzed')}</th>
                <th>{t('multi.table.distance')}</th>
                <th>{t('multi.table.firstHR')}</th>
                <th>{t('multi.table.avgPace')}</th>
                <th>{t('multi.table.gapDrift')}</th>
                <th>{t('multi.table.quality')}</th>
                <th>{t('multi.table.result')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {activities.map(act => (
                <tr key={act.id}>
                  <td>
                    <span className="color-dot" style={{ background: act.color }} />
                  </td>
                  <td>{act.date.toLocaleDateString(t('common.dateLocale'))}</td>
                  <td className="file-name">{act.fileName}</td>
                  <td className="warmup-cell">
                    {formatDuration(act.warmupDetectedAt)}
                    <span className="warmup-badge" title={t('multi.warmupBadgeTitle')}>{t('multi.warmupBadge')}</span>
                  </td>
                  <td>
                    {editingId === act.id ? (
                      <TrimEditor
                        act={act}
                        onSave={(start, end) => {
                          handleTrimChange(act.id, start, end);
                          setEditingId(null);
                        }}
                        onCancel={() => setEditingId(null)}
                      />
                    ) : (
                      <span
                        className="editable"
                        onClick={() => setEditingId(act.id)}
                        title={t('multi.editHint')}
                      >
                        {act.analyzedMinutes} min
                      </span>
                    )}
                  </td>
                  <td>{(act.activity.totalDistance / 1000).toFixed(1)} km</td>
                  <td className="hr-cell">{act.testHR} {t('common.bpm')}</td>
                  <td>{act.avgPace} /km</td>
                  <td>
                    {act.driftResult ? (
                      <span className={getDriftClass(act.driftResult.gapDecouplingPercent)}>
                        {act.driftResult.gapDecouplingPercent.toFixed(1)}%
                      </span>
                    ) : '—'}
                  </td>
                  <td>
                    <span
                      className={`quality-dot quality-${act.dataQuality.level}`}
                      title={`${t('common.quality')}: ${act.dataQuality.score}/100. ${act.dataQuality.issues.join('. ')}`}
                    >
                      {act.dataQuality.score}
                    </span>
                  </td>
                  <td>
                    {act.driftResult && (
                      <span className={`badge badge-${act.driftResult.interpretation.level}`}>
                        {t(`multi.badge.${act.driftResult.interpretation.level}`)}
                      </span>
                    )}
                  </td>
                  <td>
                    <button
                      className="btn-remove"
                      onClick={() => handleRemove(act.id)}
                      title={t('common.delete')}
                    >×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {analysis.thresholdEstimate && (
        <ThresholdPanel estimate={analysis.thresholdEstimate} />
      )}

      {analysis.sortedByHR.length >= 2 && (
        <DriftVsHRChart activities={analysis.sortedByHR} estimate={analysis.thresholdEstimate} />
      )}

      {activities.length === 0 && (
        <div className="info-box" style={{ marginTop: '2rem' }}>
          <h3>{t('multi.how.title')}</h3>
          <ol>
            <li><strong>{t('multi.how.step1')}</strong></li>
            <li>{t('multi.how.step2')}</li>
            <li><strong>{t('multi.how.step3')}</strong></li>
            <li>{t('multi.how.step4')}</li>
          </ol>
          <p>{t('multi.how.note')}</p>
        </div>
      )}
    </div>
  );
}

function getDriftClass(drift: number): string {
  if (drift < 3.5) return 'drift-low';
  if (drift <= 5.0) return 'drift-ok';
  return 'drift-high';
}

function ThresholdPanel({ estimate }: { estimate: ThresholdEstimate }) {
  const { t } = useTranslation();

  const confClass = {
    high: 'conf-high',
    medium: 'conf-medium',
    low: 'conf-low',
  }[estimate.confidence];

  return (
    <div className="threshold-panel">
      <div className="threshold-main">
        <div className="threshold-value">
          <span className="label">{t('multi.threshold.label')}</span>
          <span className="big-hr">{estimate.aetHR} <small>{t('common.bpm')}</small></span>
        </div>
        <span className={`conf-badge ${confClass}`}>
          {t(`multi.threshold.${estimate.confidence}`)}
        </span>
      </div>
      <p className="threshold-desc">{estimate.description}</p>
      {estimate.confidence === 'low' && (
        <p className="threshold-hint">{t('multi.threshold.hint')}</p>
      )}
    </div>
  );
}

function DriftVsHRChart({
  activities,
  estimate,
}: {
  activities: AnalyzedActivity[];
  estimate: ThresholdEstimate | null;
}) {
  const { t } = useTranslation();

  const data = useMemo(() => {
    const points = activities.map(a => ({
      x: a.testHR,
      y: a.driftResult!.gapDecouplingPercent,
    }));

    const minHR = Math.min(...points.map(p => p.x)) - 5;
    const maxHR = Math.max(...points.map(p => p.x)) + 5;

    const datasets: any[] = [
      {
        label: t('multi.chart.activities'),
        data: points,
        backgroundColor: activities.map(a => a.color),
        pointRadius: 8,
        pointHoverRadius: 10,
        showLine: true,
        borderWidth: 2,
        borderColor: 'rgba(148, 163, 184, 0.4)',
        tension: 0.3,
      },
      {
        label: t('multi.chart.threshold35'),
        data: [{ x: minHR, y: 3.5 }, { x: maxHR, y: 3.5 }],
        borderColor: 'rgba(16, 185, 129, 0.6)',
        borderWidth: 2,
        borderDash: [8, 4],
        pointRadius: 0,
        showLine: true,
      },
      {
        label: t('multi.chart.threshold50'),
        data: [{ x: minHR, y: 5 }, { x: maxHR, y: 5 }],
        borderColor: 'rgba(239, 68, 68, 0.6)',
        borderWidth: 2,
        borderDash: [8, 4],
        pointRadius: 0,
        showLine: true,
      },
    ];

    if (estimate) {
      datasets.push({
        label: t('multi.chart.aetLine', { hr: estimate.aetHR }),
        data: [{ x: estimate.aetHR, y: 0 }, { x: estimate.aetHR, y: Math.max(...points.map(p => p.y), 8) }],
        borderColor: 'rgba(139, 92, 246, 0.8)',
        borderWidth: 3,
        borderDash: [4, 4],
        pointRadius: 0,
        showLine: true,
      });
    }

    return { datasets };
  }, [activities, estimate, t]);

  const options: ChartOptions<'scatter'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      title: {
        display: true,
        text: t('multi.chart.title'),
        font: { size: 16 },
      },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            if (ctx.datasetIndex === 0) {
              const act = activities[ctx.dataIndex];
              return [
                `${act.fileName}`,
                t('multi.chart.tooltipHr', { hr: act.testHR, drift: act.driftResult!.gapDecouplingPercent.toFixed(1) }),
                t('multi.chart.tooltipPace', { pace: act.avgPace, date: act.date.toLocaleDateString(t('common.dateLocale')) }),
              ];
            }
            return ctx.dataset.label || '';
          },
        },
      },
    },
    scales: {
      x: {
        title: { display: true, text: t('multi.chart.xAxis') },
        type: 'linear',
      },
      y: {
        title: { display: true, text: t('multi.chart.yAxis') },
        min: 0,
      },
    },
  };

  return (
    <div className="chart-container" style={{ height: '400px' }}>
      <Scatter data={data} options={options} />
    </div>
  );
}

function TrimEditor({
  act,
  onSave,
  onCancel,
}: {
  act: AnalyzedActivity;
  onSave: (start: number, end: number) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [start, setStart] = useState(act.trimStart);
  const [end, setEnd] = useState(act.trimEnd);
  const total = act.activity.totalDuration;

  return (
    <div className="trim-editor" onClick={e => e.stopPropagation()}>
      <div className="trim-edit-row">
        <label>{t('multi.trim.start')} {formatDuration(start)}</label>
        <input type="range" min={0} max={total - 60} step={10} value={start}
          onChange={e => setStart(Number(e.target.value))} />
      </div>
      <div className="trim-edit-row">
        <label>{t('multi.trim.end')} {formatDuration(end)}</label>
        <input type="range" min={start + 60} max={total} step={10} value={end}
          onChange={e => setEnd(Number(e.target.value))} />
      </div>
      <div className="trim-edit-actions">
        <button className="btn-sm btn-save" onClick={() => onSave(start, end)}>{t('common.ok')}</button>
        <button className="btn-sm btn-cancel" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </div>
  );
}
