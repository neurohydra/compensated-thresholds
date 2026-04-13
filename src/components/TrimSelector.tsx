import { useMemo, useState, useEffect } from 'react';
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
import type { ChartOptions, Plugin } from 'chart.js';
import { Line } from 'react-chartjs-2';
import { formatDuration } from '../lib/driftAnalysis';
import type { GapModel } from '../lib/gapCalculator';
import type { EnrichedRecord } from '../lib/gapCalculator';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

interface TrimSelectorProps {
  totalDuration: number;
  trimStart: number;
  trimEnd: number;
  onTrimStartChange: (v: number) => void;
  onTrimEndChange: (v: number) => void;
  gapModel: GapModel;
  onGapModelChange: (m: GapModel) => void;
  numSegments: number;
  onNumSegmentsChange: (n: number) => void;
  records: EnrichedRecord[];
}

type ZoomMode = 'auto' | 'selected' | 'full' | 'custom';

/** Downsample records for the chart (max ~300 points) */
function downsampleForChart(records: EnrichedRecord[], maxPoints: number = 300): EnrichedRecord[] {
  if (records.length <= maxPoints) return records;
  const step = Math.ceil(records.length / maxPoints);
  return records.filter((_, i) => i % step === 0);
}

/** Calculate percentile-based bounds from HR array */
function calcBounds(hrs: number[], padding: number = 3): { min: number; max: number } {
  if (hrs.length === 0) return { min: 60, max: 200 };
  const sorted = [...hrs].sort((a, b) => a - b);
  const p2 = sorted[Math.floor(sorted.length * 0.02)];
  const p98 = sorted[Math.floor(sorted.length * 0.98)];
  return {
    min: Math.floor(p2 - padding),
    max: Math.ceil(p98 + padding),
  };
}

export function TrimSelector({
  totalDuration,
  trimStart,
  trimEnd,
  onTrimStartChange,
  onTrimEndChange,
  gapModel,
  onGapModelChange,
  numSegments,
  onNumSegmentsChange,
  records,
}: TrimSelectorProps) {
  const analyzedDuration = trimEnd - trimStart;

  const downsampled = useMemo(
    () => downsampleForChart(records.filter(r => r.heartRate != null && r.heartRate > 0)),
    [records],
  );

  const trimStartIdx = useMemo(
    () => {
      const idx = downsampled.findIndex(r => r.elapsedSeconds >= trimStart);
      return idx === -1 ? 0 : idx;
    },
    [downsampled, trimStart],
  );
  const trimEndIdx = useMemo(() => {
    const idx = downsampled.findIndex(r => r.elapsedSeconds >= trimEnd);
    return idx === -1 ? downsampled.length - 1 : idx;
  }, [downsampled, trimEnd]);

  // Precomputed bounds for different zoom modes
  const allHrs = useMemo(
    () => downsampled.map(r => r.heartRate).filter((h): h is number => h != null && h > 40),
    [downsampled],
  );
  const selectedHrs = useMemo(
    () => downsampled
      .filter((_, i) => i >= trimStartIdx && i <= trimEndIdx)
      .map(r => r.heartRate)
      .filter((h): h is number => h != null && h > 40),
    [downsampled, trimStartIdx, trimEndIdx],
  );

  const boundsAll = useMemo(() => calcBounds(allHrs, 5), [allHrs]);
  const boundsSelected = useMemo(() => calcBounds(selectedHrs, 3), [selectedHrs]);
  // "Auto" = selected area bounds but with slightly more room
  const boundsAuto = useMemo(() => calcBounds(selectedHrs, 5), [selectedHrs]);

  const [zoomMode, setZoomMode] = useState<ZoomMode>('auto');
  const [customMin, setCustomMin] = useState(boundsAuto.min);
  const [customMax, setCustomMax] = useState(boundsAuto.max);

  // Update custom bounds when auto bounds change (on file load / trim change)
  useEffect(() => {
    if (zoomMode !== 'custom') {
      setCustomMin(boundsAuto.min);
      setCustomMax(boundsAuto.max);
    }
  }, [boundsAuto.min, boundsAuto.max, zoomMode]);

  const { hrMin, hrMax } = useMemo(() => {
    switch (zoomMode) {
      case 'selected': return { hrMin: boundsSelected.min, hrMax: boundsSelected.max };
      case 'full': return { hrMin: boundsAll.min, hrMax: boundsAll.max };
      case 'custom': return { hrMin: customMin, hrMax: customMax };
      case 'auto':
      default: return { hrMin: boundsAuto.min, hrMax: boundsAuto.max };
    }
  }, [zoomMode, boundsAll, boundsSelected, boundsAuto, customMin, customMax]);

  const chartData = useMemo(() => {
    const labels = downsampled.map(r => formatDuration(r.elapsedSeconds));
    const hrData = downsampled.map(r => r.heartRate);

    return {
      labels,
      datasets: [
        {
          label: 'Syke (bpm)',
          data: hrData,
          borderWidth: 1.5,
          pointRadius: 0,
          fill: 'origin',
          tension: 0.2,
          segment: {
            borderColor: (ctx: any) => {
              const idx = ctx.p0DataIndex;
              return idx >= trimStartIdx && idx < trimEndIdx
                ? 'rgba(239, 68, 68, 0.9)'
                : 'rgba(239, 68, 68, 0.25)';
            },
            backgroundColor: (ctx: any) => {
              const idx = ctx.p0DataIndex;
              return idx >= trimStartIdx && idx < trimEndIdx
                ? 'rgba(239, 68, 68, 0.15)'
                : 'rgba(239, 68, 68, 0.03)';
            },
          },
        },
      ],
    };
  }, [downsampled, trimStartIdx, trimEndIdx]);

  // Custom plugin to draw selection overlay
  const selectionPlugin: Plugin<'line'> = useMemo(() => ({
    id: 'selectionOverlay',
    afterDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      if (!chartArea || !scales.x) return;

      const xScale = scales.x;

      let startPixel = chartArea.left;
      let endPixel = chartArea.right;

      for (let i = 0; i < (chart.data.labels?.length ?? 0); i++) {
        if (i === trimStartIdx) startPixel = xScale.getPixelForValue(i);
        if (i === trimEndIdx) endPixel = xScale.getPixelForValue(i);
      }

      ctx.save();

      // Dim outside regions
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.fillRect(chartArea.left, chartArea.top, startPixel - chartArea.left, chartArea.height);
      ctx.fillRect(endPixel, chartArea.top, chartArea.right - endPixel, chartArea.height);

      // Selection boundary lines
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);

      ctx.beginPath();
      ctx.moveTo(startPixel, chartArea.top);
      ctx.lineTo(startPixel, chartArea.bottom);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(endPixel, chartArea.top);
      ctx.lineTo(endPixel, chartArea.bottom);
      ctx.stroke();

      // Labels
      ctx.setLineDash([]);
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';

      if (startPixel - chartArea.left > 60) {
        ctx.fillStyle = 'rgba(148, 163, 184, 0.6)';
        ctx.fillText('LÄMMITTELY', (chartArea.left + startPixel) / 2, chartArea.top + 16);
      }

      ctx.fillStyle = 'rgba(239, 68, 68, 0.8)';
      ctx.fillText('ANALYSOITAVA OSUUS', (startPixel + endPixel) / 2, chartArea.top + 16);

      ctx.restore();
    },
  }), [trimStartIdx, trimEndIdx]);

  const chartOptions: ChartOptions<'line'> = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 0 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      title: { display: false },
      tooltip: {
        callbacks: {
          title: (items) => items[0]?.label ?? '',
          label: (ctx) => `Syke: ${ctx.parsed.y} bpm`,
        },
      },
    },
    scales: {
      x: {
        display: true,
        ticks: {
          maxTicksLimit: 10,
          font: { size: 10 },
          color: 'rgba(148, 163, 184, 0.6)',
        },
        grid: { display: false },
      },
      y: {
        display: true,
        min: hrMin,
        max: hrMax,
        title: { display: true, text: 'bpm', font: { size: 10 }, color: 'rgba(148,163,184,0.5)' },
        ticks: {
          font: { size: 10 },
          color: 'rgba(148, 163, 184, 0.6)',
          stepSize: hrMax - hrMin > 40 ? 10 : 5,
        },
        grid: { color: 'rgba(148, 163, 184, 0.08)' },
      },
    },
  }), [hrMin, hrMax]);

  return (
    <div className="trim-selector">
      <h3>Analyysiasetukset</h3>

      <div className="trim-controls">
        {/* Chart with zoom controls */}
        <div className="trim-chart-wrapper">
          <div className="trim-chart-container">
            {downsampled.length > 0 && (
              <Line data={chartData} options={chartOptions} plugins={[selectionPlugin]} />
            )}
          </div>

          {/* Zoom controls */}
          <div className="zoom-controls">
            <span className="zoom-label">Sykealue:</span>
            <div className="zoom-buttons">
              <button
                className={`zoom-btn ${zoomMode === 'auto' ? 'active' : ''}`}
                onClick={() => setZoomMode('auto')}
                title="Automaattinen: analysoitavan alueen sykkeet ±5 bpm"
              >
                Auto
              </button>
              <button
                className={`zoom-btn ${zoomMode === 'selected' ? 'active' : ''}`}
                onClick={() => setZoomMode('selected')}
                title="Tiukka: analysoitavan alueen sykkeet tiiviisti"
              >
                Tiukka
              </button>
              <button
                className={`zoom-btn ${zoomMode === 'full' ? 'active' : ''}`}
                onClick={() => setZoomMode('full')}
                title="Koko: kaikki sykearvot mukaan"
              >
                Koko
              </button>
              <button
                className={`zoom-btn ${zoomMode === 'custom' ? 'active' : ''}`}
                onClick={() => setZoomMode('custom')}
                title="Oma: säädä min/max itse"
              >
                Oma
              </button>
            </div>

            {zoomMode === 'custom' && (
              <div className="zoom-custom">
                <div className="zoom-input-group">
                  <label>Min</label>
                  <input
                    type="number"
                    value={customMin}
                    onChange={e => setCustomMin(Number(e.target.value))}
                    min={30}
                    max={customMax - 5}
                    step={5}
                  />
                </div>
                <span className="zoom-dash">–</span>
                <div className="zoom-input-group">
                  <label>Max</label>
                  <input
                    type="number"
                    value={customMax}
                    onChange={e => setCustomMax(Number(e.target.value))}
                    min={customMin + 5}
                    max={220}
                    step={5}
                  />
                </div>
                <span className="zoom-range-info">{customMax - customMin} bpm alue</span>
              </div>
            )}

            <span className="zoom-info">{hrMin}–{hrMax} bpm</span>
          </div>
        </div>

        <div className="trim-group">
          <label>
            Aloitusaika (lämmittely pois)
            <span className="trim-value">{formatDuration(trimStart)}</span>
          </label>
          <input
            type="range"
            min={0}
            max={totalDuration - 60}
            step={10}
            value={trimStart}
            onChange={e => onTrimStartChange(Number(e.target.value))}
          />
        </div>

        <div className="trim-group">
          <label>
            Lopetusaika
            <span className="trim-value">{formatDuration(trimEnd)}</span>
          </label>
          <input
            type="range"
            min={trimStart + 60}
            max={totalDuration}
            step={10}
            value={trimEnd}
            onChange={e => onTrimEndChange(Number(e.target.value))}
          />
        </div>

        <div className="trim-info">
          Analysoitava kesto: <strong>{formatDuration(analyzedDuration)}</strong>
          {analyzedDuration < 2400 && (
            <span className="warning"> (suositellaan vähintään 40 min)</span>
          )}
        </div>
      </div>

      <div className="settings-row">
        <div className="setting">
          <label>GAP-malli</label>
          <select value={gapModel} onChange={e => onGapModelChange(e.target.value as GapModel)}>
            <option value="strava">Strava (suositeltu)</option>
            <option value="minetti">Minetti (2002)</option>
          </select>
        </div>

        <div className="setting">
          <label>Segmenttejä</label>
          <select value={numSegments} onChange={e => onNumSegmentsChange(Number(e.target.value))}>
            <option value={6}>6</option>
            <option value={8}>8</option>
            <option value={10}>10</option>
            <option value={12}>12</option>
            <option value={20}>20</option>
          </select>
        </div>
      </div>
    </div>
  );
}
