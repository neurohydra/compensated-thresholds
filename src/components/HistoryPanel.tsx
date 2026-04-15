import { useState, useMemo } from 'react';
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
import {
  loadHistory,
  removeFromHistory,
  getHistoryStats,
  exportHistory,
  importHistory,
} from '../lib/historyStore';
import type { HistoryEntry } from '../lib/historyStore';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

interface HistoryPanelProps {
  onBack: () => void;
}

export function HistoryPanel({ onBack }: HistoryPanelProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState(() => loadHistory());
  const [importError, setImportError] = useState<string | null>(null);
  const stats = useMemo(() => getHistoryStats(), [entries]);

  const handleRemove = (id: string) => {
    removeFromHistory(id);
    setEntries(loadHistory());
  };

  const handleExport = () => {
    const json = exportHistory();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `thresholds-history-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const count = importHistory(text);
      setImportError(null);
      setEntries(loadHistory());
      alert(t('history.imported', { count }));
    } catch (err) {
      setImportError(err instanceof Error ? err.message : t('history.importError'));
    }
    e.target.value = '';
  };

  return (
    <div className="history-panel">
      <div className="toolbar">
        <button onClick={onBack} className="btn-reset">{t('common.back')}</button>
        <div className="toolbar-actions">
          <button onClick={handleExport} className="btn-secondary" disabled={entries.length === 0}>
            {t('history.export')}
          </button>
          <label className="btn-secondary">
            {t('history.import')}
            <input type="file" accept=".json" onChange={handleImport} style={{ display: 'none' }} />
          </label>
        </div>
      </div>

      <h2>{t('history.heading')}</h2>

      {importError && <div className="error">{importError}</div>}

      {entries.length > 0 && (
        <div className="history-stats">
          {stats.latestAeT != null && (
            <div className="stat-card stat-primary">
              <span className="label">{t('history.latestAeT')}</span>
              <span className="big-value">{stats.latestAeT} <small>{t('common.bpm')}</small></span>
              {stats.aetTrend != null && (
                <span className={`trend ${stats.aetTrend > 0 ? 'trend-up' : stats.aetTrend < -0.5 ? 'trend-down' : 'trend-flat'}`}>
                  {stats.aetTrend > 0 ? '↑' : stats.aetTrend < -0.5 ? '↓' : '→'} {Math.abs(stats.aetTrend).toFixed(1)} {t('history.trend.bpmPerTest')}
                </span>
              )}
            </div>
          )}
          {stats.latestLT != null && (
            <div className="stat-card">
              <span className="label">{t('history.latestLT2')}</span>
              <span className="big-value">{stats.latestLT} <small>{t('common.bpm')}</small></span>
            </div>
          )}
          {stats.aetLtRatio != null && (
            <div className="stat-card">
              <span className="label">{t('history.aetLt2')}</span>
              <span className="big-value">{(stats.aetLtRatio * 100).toFixed(0)}<small>%</small></span>
              <span className="trend trend-info">
                {stats.aetLtRatio > 0.85 ? t('history.insight.wellTrained') :
                 stats.aetLtRatio > 0.75 ? t('history.insight.goodBase') :
                 t('history.insight.needsWork')}
              </span>
            </div>
          )}
          <div className="stat-card">
            <span className="label">{t('history.analyses')}</span>
            <span className="big-value">{stats.totalAnalyses}</span>
          </div>
        </div>
      )}

      {entries.length >= 2 && <HistoryChart entries={entries} />}

      {entries.length > 0 ? (
        <div className="history-list">
          <table>
            <thead>
              <tr>
                <th>{t('history.table.day')}</th>
                <th>{t('history.table.file')}</th>
                <th>{t('history.table.method')}</th>
                <th>{t('history.table.aet')}</th>
                <th>{t('history.table.lt2')}</th>
                <th>{t('history.table.drift')}</th>
                <th>{t('history.table.dfa')}</th>
                <th>{t('history.table.temp')}</th>
                <th>{t('history.table.confidence')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {[...entries].reverse().map(entry => (
                <tr key={entry.id}>
                  <td>{new Date(entry.date).toLocaleDateString(t('common.dateLocale'))}</td>
                  <td className="file-name">{entry.fileName}</td>
                  <td>
                    <span className="method-badge">{methodLabel(entry.method, t)}</span>
                  </td>
                  <td className="hr-cell">{entry.aetHR ?? '—'}</td>
                  <td className="hr-cell">{entry.ltHR ?? '—'}</td>
                  <td>{entry.driftPercent != null ? `${entry.driftPercent.toFixed(1)}%` : '—'}</td>
                  <td>{entry.dfaAlpha1 != null ? entry.dfaAlpha1.toFixed(2) : '—'}</td>
                  <td>{entry.temperature != null ? `${entry.temperature.toFixed(0)}°C` : '—'}</td>
                  <td>
                    <span className={`badge badge-${confToLevel(entry.confidence)}`}>
                      {confLabel(entry.confidence, t)}
                    </span>
                  </td>
                  <td>
                    <button className="btn-remove" onClick={() => handleRemove(entry.id)} title={t('common.delete')}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="info-box" style={{ marginTop: '2rem' }}>
          <h3>{t('history.empty.title')}</h3>
          <p>{t('history.empty.text')}</p>
        </div>
      )}
    </div>
  );
}

function HistoryChart({ entries }: { entries: HistoryEntry[] }) {
  const { t } = useTranslation();
  const aetEntries = entries.filter(e => e.aetHR != null);
  const ltEntries = entries.filter(e => e.ltHR != null);

  const data = useMemo(() => {
    const labels = aetEntries.map(e => new Date(e.date).toLocaleDateString(t('common.dateLocale')));

    const datasets: any[] = [
      {
        label: t('history.chart.aet'),
        data: aetEntries.map(e => e.aetHR),
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        borderWidth: 2,
        pointRadius: 5,
        pointBackgroundColor: aetEntries.map(e =>
          e.method === 'combined' ? '#8b5cf6' :
          e.method === 'dfa-alpha1' ? '#3b82f6' : '#10b981'
        ),
        fill: true,
        tension: 0.3,
      },
    ];

    if (ltEntries.length >= 2) {
      datasets.push({
        label: t('history.chart.lt2'),
        data: ltEntries.map(e => e.ltHR),
        borderColor: '#ef4444',
        backgroundColor: 'rgba(239, 68, 68, 0.05)',
        borderWidth: 2,
        pointRadius: 4,
        borderDash: [5, 5],
        fill: true,
        tension: 0.3,
      });
    }

    return { labels, datasets };
  }, [aetEntries, ltEntries, t]);

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      title: { display: true, text: t('history.chart.title'), font: { size: 16 } },
      tooltip: {
        callbacks: {
          afterLabel: (ctx) => {
            const entry = aetEntries[ctx.dataIndex];
            const parts: string[] = [];
            if (entry.method) parts.push(`${t('history.chart.method')} ${methodLabel(entry.method, t)}`);
            if (entry.driftPercent != null) parts.push(`${t('history.chart.drift')} ${entry.driftPercent.toFixed(1)}%`);
            if (entry.temperature != null) parts.push(`${t('history.chart.temp')} ${entry.temperature.toFixed(0)}°C`);
            return parts;
          },
        },
      },
    },
    scales: {
      y: { title: { display: true, text: t('history.chart.hrAxis') } },
    },
  };

  return (
    <div className="chart-container" style={{ height: '350px', marginBottom: '1.5rem' }}>
      <Line data={data} options={options} />
    </div>
  );
}

function methodLabel(method: string, t: TFunction): string {
  switch (method) {
    case 'drift': return t('history.method.drift');
    case 'dfa-alpha1': return t('history.method.dfa');
    case 'combined': return t('history.method.combined');
    case 'multi-file': return t('history.method.multi');
    default: return method;
  }
}

function confToLevel(conf: string): string {
  switch (conf) {
    case 'high': return 'at';
    case 'medium': return 'below';
    case 'low': return 'above';
    default: return 'below';
  }
}

function confLabel(conf: string, t: TFunction): string {
  switch (conf) {
    case 'high': return t('history.conf.high');
    case 'medium': return t('history.conf.medium');
    case 'low': return t('history.conf.low');
    default: return conf;
  }
}
