import { useMemo } from 'react';
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
  const { t } = useTranslation();

  const filtered = useMemo(() => {
    const f = records.filter(r => r.elapsedSeconds >= trimStart && r.elapsedSeconds <= trimEnd);
    return downsample(f);
  }, [records, trimStart, trimEnd]);

  const timeLabels = filtered.map(r => formatDuration(r.elapsedSeconds));

  const hrPaceData = useMemo(() => ({
    labels: timeLabels,
    datasets: [
      {
        label: t('charts.hrPace.hrLabel'),
        data: filtered.map(r => r.heartRate),
        borderColor: '#ef4444',
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        borderWidth: 1.5,
        pointRadius: 0,
        fill: true,
        yAxisID: 'y',
      },
      {
        label: t('charts.hrPace.paceLabel'),
        data: filtered.map(r => r.gapSpeed ? 1000 / r.gapSpeed : null),
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        borderWidth: 1.5,
        pointRadius: 0,
        fill: true,
        yAxisID: 'y1',
      },
    ],
  }), [filtered, timeLabels, t]);

  const hrPaceOptions: ChartOptions<'line'> = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      title: { display: true, text: t('charts.hrPace.title'), font: { size: 14 } },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            if (ctx.datasetIndex === 0) return t('charts.hrPace.hrTooltip', { value: ctx.parsed.y });
            const y = ctx.parsed.y;
            if (y != null) return t('charts.hrPace.gapTooltip', { value: speedToPace(1000 / y) });
            return '';
          },
        },
      },
    },
    scales: {
      y: {
        type: 'linear',
        position: 'left',
        title: { display: true, text: t('charts.hrPace.hrAxis') },
      },
      y1: {
        type: 'linear',
        position: 'right',
        reverse: true,
        title: { display: true, text: t('charts.hrPace.paceAxis') },
        grid: { drawOnChartArea: false },
        ticks: {
          callback: (value) => speedToPace(1000 / (value as number)),
        },
      },
    },
  }), [t]);

  const elevGradeData = useMemo(() => ({
    labels: timeLabels,
    datasets: [
      {
        label: t('charts.elevation.elevLabel'),
        data: filtered.map(r => r.smoothedAltitude),
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.2)',
        borderWidth: 1.5,
        pointRadius: 0,
        fill: true,
        yAxisID: 'y',
      },
      {
        label: t('charts.elevation.gradeLabel'),
        data: filtered.map(r => r.grade * 100),
        borderColor: '#f59e0b',
        borderWidth: 1,
        pointRadius: 0,
        yAxisID: 'y1',
      },
    ],
  }), [filtered, timeLabels, t]);

  const elevGradeOptions: ChartOptions<'line'> = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      title: { display: true, text: t('charts.elevation.title'), font: { size: 14 } },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            if (ctx.datasetIndex === 0) return t('charts.elevation.elevTooltip', { value: ctx.parsed.y?.toFixed(1) });
            return t('charts.elevation.gradeTooltip', { value: ctx.parsed.y?.toFixed(1) });
          },
        },
      },
    },
    scales: {
      y: {
        type: 'linear',
        position: 'left',
        title: { display: true, text: t('charts.elevation.elevAxis') },
      },
      y1: {
        type: 'linear',
        position: 'right',
        title: { display: true, text: t('charts.elevation.gradeAxis') },
        grid: { drawOnChartArea: false },
      },
    },
  }), [t]);

  const segLabels = segments.map((_, i) => `${i + 1}`);

  const segData = useMemo(() => ({
    labels: segLabels,
    datasets: [
      {
        label: t('charts.ef.gapLabel'),
        data: segments.map(s => s.gapEf * 1000),
        borderColor: '#8b5cf6',
        backgroundColor: 'rgba(139, 92, 246, 0.2)',
        borderWidth: 2,
        pointRadius: 4,
        fill: true,
      },
      {
        label: t('charts.ef.rawLabel'),
        data: segments.map(s => s.ef * 1000),
        borderColor: '#6b7280',
        backgroundColor: 'rgba(107, 114, 128, 0.1)',
        borderWidth: 1.5,
        pointRadius: 3,
        borderDash: [5, 5],
      },
    ],
  }), [segments, segLabels, t]);

  const segOptions: ChartOptions<'line'> = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      title: { display: true, text: t('charts.ef.title'), font: { size: 14 } },
      tooltip: {
        callbacks: {
          title: (items) => {
            const idx = items[0].dataIndex;
            const seg = segments[idx];
            return t('charts.ef.segTooltipTitle', { n: idx + 1, start: formatDuration(seg.startSeconds), end: formatDuration(seg.endSeconds) });
          },
          label: (ctx) => {
            const seg = segments[ctx.dataIndex];
            const label = ctx.datasetIndex === 0 ? t('charts.ef.gapTooltip') : t('charts.ef.rawTooltip');
            const yVal = ctx.parsed.y;
            return `${label}: ${yVal != null ? yVal.toFixed(2) : '—'} | ${t('charts.ef.hrTooltip', { value: seg.avgHR.toFixed(0) })}`;
          },
        },
      },
    },
    scales: {
      x: { title: { display: true, text: t('charts.ef.xAxis') } },
      y: { title: { display: true, text: t('charts.ef.yAxis') } },
    },
  }), [segments, t]);

  const hrSegData = useMemo(() => ({
    labels: segLabels,
    datasets: [
      {
        label: t('charts.hrSeg.label'),
        data: segments.map(s => s.avgHR),
        borderColor: '#ef4444',
        backgroundColor: 'rgba(239, 68, 68, 0.2)',
        borderWidth: 2,
        pointRadius: 4,
        fill: true,
      },
    ],
  }), [segments, segLabels, t]);

  const hrSegOptions: ChartOptions<'line'> = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      title: { display: true, text: t('charts.hrSeg.title'), font: { size: 14 } },
    },
    scales: {
      x: { title: { display: true, text: t('charts.hrSeg.xAxis') } },
      y: { title: { display: true, text: t('charts.hrSeg.yAxis') } },
    },
  }), [t]);

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
