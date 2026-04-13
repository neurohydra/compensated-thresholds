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
import type { EnrichedRecord } from '../lib/gapCalculator';
import type { SegmentDrift } from '../lib/driftAnalysis';
import { speedToPace, formatDuration } from '../lib/driftAnalysis';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

interface ChartsProps {
  records: EnrichedRecord[];
  segments: SegmentDrift[];
  trimStart: number;
  trimEnd: number;
}

function downsample(records: EnrichedRecord[], maxPoints: number = 500): EnrichedRecord[] {
  if (records.length <= maxPoints) return records;
  const step = Math.ceil(records.length / maxPoints);
  return records.filter((_, i) => i % step === 0);
}

export function Charts({ records, segments, trimStart, trimEnd }: ChartsProps) {
  const filtered = useMemo(() => {
    const f = records.filter(r => r.elapsedSeconds >= trimStart && r.elapsedSeconds <= trimEnd);
    return downsample(f);
  }, [records, trimStart, trimEnd]);

  const midTime = (trimStart + trimEnd) / 2;

  const timeLabels = filtered.map(r => formatDuration(r.elapsedSeconds));

  const hrPaceData = useMemo(() => ({
    labels: timeLabels,
    datasets: [
      {
        label: 'Syke (bpm)',
        data: filtered.map(r => r.heartRate),
        borderColor: '#ef4444',
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        borderWidth: 1.5,
        pointRadius: 0,
        fill: true,
        yAxisID: 'y',
      },
      {
        label: 'GAP-vauhti (s/km)',
        data: filtered.map(r => r.gapSpeed ? 1000 / r.gapSpeed : null),
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        borderWidth: 1.5,
        pointRadius: 0,
        fill: true,
        yAxisID: 'y1',
      },
    ],
  }), [filtered, timeLabels]);

  const hrPaceOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      title: { display: true, text: 'Syke ja GAP-vauhti', font: { size: 14 } },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            if (ctx.datasetIndex === 0) return `Syke: ${ctx.parsed.y} bpm`;
            if (ctx.parsed.y) return `GAP: ${speedToPace(1000 / ctx.parsed.y)} /km`;
            return '';
          },
        },
      },
    },
    scales: {
      y: {
        type: 'linear',
        position: 'left',
        title: { display: true, text: 'Syke (bpm)' },
      },
      y1: {
        type: 'linear',
        position: 'right',
        reverse: true,
        title: { display: true, text: 'Vauhti (s/km)' },
        grid: { drawOnChartArea: false },
        ticks: {
          callback: (value) => speedToPace(1000 / (value as number)),
        },
      },
    },
  };

  const elevGradeData = useMemo(() => ({
    labels: timeLabels,
    datasets: [
      {
        label: 'Korkeus (m)',
        data: filtered.map(r => r.smoothedAltitude),
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.2)',
        borderWidth: 1.5,
        pointRadius: 0,
        fill: true,
        yAxisID: 'y',
      },
      {
        label: 'Kaltevuus (%)',
        data: filtered.map(r => r.grade * 100),
        borderColor: '#f59e0b',
        borderWidth: 1,
        pointRadius: 0,
        yAxisID: 'y1',
      },
    ],
  }), [filtered, timeLabels]);

  const elevGradeOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      title: { display: true, text: 'Korkeus ja kaltevuus', font: { size: 14 } },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            if (ctx.datasetIndex === 0) return `Korkeus: ${ctx.parsed.y?.toFixed(1)} m`;
            return `Kaltevuus: ${ctx.parsed.y?.toFixed(1)}%`;
          },
        },
      },
    },
    scales: {
      y: {
        type: 'linear',
        position: 'left',
        title: { display: true, text: 'Korkeus (m)' },
      },
      y1: {
        type: 'linear',
        position: 'right',
        title: { display: true, text: 'Kaltevuus (%)' },
        grid: { drawOnChartArea: false },
      },
    },
  };

  // Segment EF chart
  const segLabels = segments.map((s, i) => `${i + 1}`);
  const segData = useMemo(() => ({
    labels: segLabels,
    datasets: [
      {
        label: 'EF (GAP-kompensoitu)',
        data: segments.map(s => s.gapEf * 1000),
        borderColor: '#8b5cf6',
        backgroundColor: 'rgba(139, 92, 246, 0.2)',
        borderWidth: 2,
        pointRadius: 4,
        fill: true,
      },
      {
        label: 'EF (raaka)',
        data: segments.map(s => s.ef * 1000),
        borderColor: '#6b7280',
        backgroundColor: 'rgba(107, 114, 128, 0.1)',
        borderWidth: 1.5,
        pointRadius: 3,
        borderDash: [5, 5],
      },
    ],
  }), [segments, segLabels]);

  const segOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      title: { display: true, text: 'Efficiency Factor segmenteittäin', font: { size: 14 } },
      tooltip: {
        callbacks: {
          title: (items) => {
            const idx = items[0].dataIndex;
            const seg = segments[idx];
            return `Segmentti ${idx + 1}: ${formatDuration(seg.startSeconds)} - ${formatDuration(seg.endSeconds)}`;
          },
          label: (ctx) => {
            const seg = segments[ctx.dataIndex];
            const label = ctx.datasetIndex === 0 ? 'GAP EF' : 'Raw EF';
            return `${label}: ${ctx.parsed.y.toFixed(2)} | HR: ${seg.avgHR.toFixed(0)} bpm`;
          },
        },
      },
    },
    scales: {
      x: { title: { display: true, text: 'Segmentti' } },
      y: { title: { display: true, text: 'EF (×1000)' } },
    },
  };

  // HR segments chart
  const hrSegData = useMemo(() => ({
    labels: segLabels,
    datasets: [
      {
        label: 'Kesk. syke (bpm)',
        data: segments.map(s => s.avgHR),
        borderColor: '#ef4444',
        backgroundColor: 'rgba(239, 68, 68, 0.2)',
        borderWidth: 2,
        pointRadius: 4,
        fill: true,
      },
    ],
  }), [segments, segLabels]);

  const hrSegOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      title: { display: true, text: 'Syke segmenteittäin', font: { size: 14 } },
    },
    scales: {
      x: { title: { display: true, text: 'Segmentti' } },
      y: { title: { display: true, text: 'Syke (bpm)' } },
    },
  };

  return (
    <div className="charts">
      <div className="chart-container">
        <Line data={hrPaceData} options={hrPaceOptions} />
      </div>
      <div className="chart-container">
        <Line data={elevGradeData} options={elevGradeOptions} />
      </div>
      <div className="chart-row">
        <div className="chart-container half">
          <Line data={segData} options={segOptions} />
        </div>
        <div className="chart-container half">
          <Line data={hrSegData} options={hrSegOptions} />
        </div>
      </div>
    </div>
  );
}
