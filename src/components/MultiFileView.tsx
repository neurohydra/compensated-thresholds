import { useState, useMemo, useCallback } from 'react';
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
import { Scatter, Line } from 'react-chartjs-2';
import { parseFitFile } from '../lib/fitParser';
import { createAnalyzedActivity, reanalyzeActivity, runMultiAnalysis } from '../lib/multiAnalysis';
import type { AnalyzedActivity, ThresholdEstimate } from '../lib/multiAnalysis';
import { formatDuration, speedToPace } from '../lib/driftAnalysis';
import type { GapModel } from '../lib/gapCalculator';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

interface MultiFileViewProps {
  onBack: () => void;
}

export function MultiFileView({ onBack }: MultiFileViewProps) {
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
        setError(`Virhe tiedostossa ${files[i].name}: ${err instanceof Error ? err.message : 'Tuntematon'}`);
      }
    }

    setActivities(prev => [...prev, ...newActivities]);
    setLoading(false);
    // Reset input
    e.target.value = '';
  }, [activities.length, gapModel]);

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
        <button onClick={onBack} className="btn-reset">← Yksittäinen analyysi</button>
      </div>

      <div className="multi-header">
        <h2>Monen suorituksen analyysi</h2>
        <p className="text-muted">
          Lataa useita juoksuja eri sykealueilta. Sovellus etsii missä sykkeessä drifti ylittää
          3.5% rajan ja ehdottaa aerobista kynnystäsi.
        </p>
      </div>

      {/* File upload */}
      <div className="multi-upload">
        <label className="upload-btn">
          + Lisää FIT-tiedostoja
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
          <label>GAP-malli</label>
          <select value={gapModel} onChange={e => setGapModel(e.target.value as GapModel)}>
            <option value="strava">Strava</option>
            <option value="minetti">Minetti</option>
          </select>
        </div>
        {loading && <span className="spinner" />}
      </div>

      {error && <div className="error">{error}</div>}

      {/* Activity list */}
      {activities.length > 0 && (
        <div className="activity-list">
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Päivä</th>
                <th>Tiedosto</th>
                <th>Lämmittely</th>
                <th>Analysoitu</th>
                <th>Matka</th>
                <th>1. puolisko HR</th>
                <th>Kesk. vauhti</th>
                <th>GAP Drifti</th>
                <th>Laatu</th>
                <th>Tulos</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {activities.map(act => (
                <tr key={act.id}>
                  <td>
                    <span className="color-dot" style={{ background: act.color }} />
                  </td>
                  <td>{act.date.toLocaleDateString('fi-FI')}</td>
                  <td className="file-name">{act.fileName}</td>
                  <td className="warmup-cell">
                    {formatDuration(act.warmupDetectedAt)}
                    <span className="warmup-badge" title="Automaattisesti tunnistettu sykkeen tasaantumisesta">auto</span>
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
                        title="Klikkaa muokataksesi analysoitavaa aluetta"
                      >
                        {act.analyzedMinutes} min
                      </span>
                    )}
                  </td>
                  <td>{(act.activity.totalDistance / 1000).toFixed(1)} km</td>
                  <td className="hr-cell">{act.testHR} bpm</td>
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
                      title={`Datan laatu: ${act.dataQuality.score}/100. ${act.dataQuality.issues.join('. ')}`}
                    >
                      {act.dataQuality.score}
                    </span>
                  </td>
                  <td>
                    {act.driftResult && (
                      <span className={`badge badge-${act.driftResult.interpretation.level}`}>
                        {act.driftResult.interpretation.level === 'below' ? '< AeT' :
                         act.driftResult.interpretation.level === 'at' ? '= AeT' : '> AeT'}
                      </span>
                    )}
                  </td>
                  <td>
                    <button
                      className="btn-remove"
                      onClick={() => handleRemove(act.id)}
                      title="Poista"
                    >×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Threshold estimate */}
      {analysis.thresholdEstimate && (
        <ThresholdPanel estimate={analysis.thresholdEstimate} />
      )}

      {/* Main chart: HR vs Drift scatter */}
      {analysis.sortedByHR.length >= 2 && (
        <DriftVsHRChart activities={analysis.sortedByHR} estimate={analysis.thresholdEstimate} />
      )}

      {activities.length === 0 && (
        <div className="info-box" style={{ marginTop: '2rem' }}>
          <h3>Miten monen suorituksen analyysi toimii?</h3>
          <ol>
            <li><strong>Lataa 3–6 juoksua</strong> eri intensiteeteillä (helppo, kohtalainen, reipas)</li>
            <li>Sovellus laskee GAP-kompensoidun driftin jokaiselle</li>
            <li><strong>Kuvaaja</strong> näyttää driftin suhteessa sykkeeseen</li>
            <li>Sovellus <strong>interpoloi</strong> missä sykkeessä 3.5% raja ylittyy = AeT</li>
          </ol>
          <p>
            Paras tulos saadaan kun suoritukset ovat tasavauhtisia (ei intervalleja),
            vähintään 40 min pitkiä, ja eri sykealueilla.
          </p>
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
  const confClass = {
    high: 'conf-high',
    medium: 'conf-medium',
    low: 'conf-low',
  }[estimate.confidence];

  return (
    <div className="threshold-panel">
      <div className="threshold-main">
        <div className="threshold-value">
          <span className="label">Arvioitu aerobinen kynnys (AeT)</span>
          <span className="big-hr">{estimate.aetHR} <small>bpm</small></span>
        </div>
        <span className={`conf-badge ${confClass}`}>
          {estimate.confidence === 'high' ? 'Korkea luottamus' :
           estimate.confidence === 'medium' ? 'Kohtalainen luottamus' : 'Matala luottamus'}
        </span>
      </div>
      <p className="threshold-desc">{estimate.description}</p>
      {estimate.confidence === 'low' && (
        <p className="threshold-hint">
          Lisää suorituksia lähempänä kynnysaluetta paremman arvion saamiseksi.
        </p>
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
  const data = useMemo(() => {
    const points = activities.map(a => ({
      x: a.testHR,
      y: a.driftResult!.gapDecouplingPercent,
    }));

    const minHR = Math.min(...points.map(p => p.x)) - 5;
    const maxHR = Math.max(...points.map(p => p.x)) + 5;

    const datasets: any[] = [
      {
        label: 'Suoritukset',
        data: points,
        backgroundColor: activities.map(a => a.color),
        borderColor: activities.map(a => a.color),
        pointRadius: 8,
        pointHoverRadius: 10,
        showLine: true,
        borderWidth: 2,
        borderColor: 'rgba(148, 163, 184, 0.4)',
        tension: 0.3,
      },
      // 3.5% threshold line
      {
        label: 'AeT alaraja (3.5%)',
        data: [{ x: minHR, y: 3.5 }, { x: maxHR, y: 3.5 }],
        borderColor: 'rgba(16, 185, 129, 0.6)',
        borderWidth: 2,
        borderDash: [8, 4],
        pointRadius: 0,
        showLine: true,
      },
      // 5% threshold line
      {
        label: 'AeT yläraja (5%)',
        data: [{ x: minHR, y: 5 }, { x: maxHR, y: 5 }],
        borderColor: 'rgba(239, 68, 68, 0.6)',
        borderWidth: 2,
        borderDash: [8, 4],
        pointRadius: 0,
        showLine: true,
      },
    ];

    // AeT vertical line
    if (estimate) {
      datasets.push({
        label: `AeT: ${estimate.aetHR} bpm`,
        data: [{ x: estimate.aetHR, y: 0 }, { x: estimate.aetHR, y: Math.max(...points.map(p => p.y), 8) }],
        borderColor: 'rgba(139, 92, 246, 0.8)',
        borderWidth: 3,
        borderDash: [4, 4],
        pointRadius: 0,
        showLine: true,
      });
    }

    return { datasets };
  }, [activities, estimate]);

  const options: ChartOptions<'scatter'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      title: {
        display: true,
        text: 'Syke vs. Drifti — Aerobisen kynnyksen haku',
        font: { size: 16 },
      },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            if (ctx.datasetIndex === 0) {
              const act = activities[ctx.dataIndex];
              return [
                `${act.fileName}`,
                `HR: ${act.testHR} bpm | Drifti: ${act.driftResult!.gapDecouplingPercent.toFixed(1)}%`,
                `Vauhti: ${act.avgPace} /km | ${act.date.toLocaleDateString('fi-FI')}`,
              ];
            }
            return ctx.dataset.label || '';
          },
        },
      },
    },
    scales: {
      x: {
        title: { display: true, text: '1. puoliskon keskisyke (bpm)' },
        type: 'linear',
      },
      y: {
        title: { display: true, text: 'GAP-kompensoitu drifti (%)' },
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
  const [start, setStart] = useState(act.trimStart);
  const [end, setEnd] = useState(act.trimEnd);
  const total = act.activity.totalDuration;

  return (
    <div className="trim-editor" onClick={e => e.stopPropagation()}>
      <div className="trim-edit-row">
        <label>Alku: {formatDuration(start)}</label>
        <input type="range" min={0} max={total - 60} step={10} value={start}
          onChange={e => setStart(Number(e.target.value))} />
      </div>
      <div className="trim-edit-row">
        <label>Loppu: {formatDuration(end)}</label>
        <input type="range" min={start + 60} max={total} step={10} value={end}
          onChange={e => setEnd(Number(e.target.value))} />
      </div>
      <div className="trim-edit-actions">
        <button className="btn-sm btn-save" onClick={() => onSave(start, end)}>OK</button>
        <button className="btn-sm btn-cancel" onClick={onCancel}>Peruuta</button>
      </div>
    </div>
  );
}
