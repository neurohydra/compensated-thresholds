import { useState, useMemo } from 'react';
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
      alert(`Tuotu ${count} uutta merkintää.`);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Virhe tuonnissa');
    }
    e.target.value = '';
  };

  return (
    <div className="history-panel">
      <div className="toolbar">
        <button onClick={onBack} className="btn-reset">← Takaisin</button>
        <div className="toolbar-actions">
          <button onClick={handleExport} className="btn-secondary" disabled={entries.length === 0}>
            Vie JSON
          </button>
          <label className="btn-secondary">
            Tuo JSON
            <input type="file" accept=".json" onChange={handleImport} style={{ display: 'none' }} />
          </label>
        </div>
      </div>

      <h2>Kynnysarvojen seuranta</h2>

      {importError && <div className="error">{importError}</div>}

      {/* Stats summary */}
      {entries.length > 0 && (
        <div className="history-stats">
          {stats.latestAeT != null && (
            <div className="stat-card stat-primary">
              <span className="label">Viimeisin AeT</span>
              <span className="big-value">{stats.latestAeT} <small>bpm</small></span>
              {stats.aetTrend != null && (
                <span className={`trend ${stats.aetTrend > 0 ? 'trend-up' : stats.aetTrend < -0.5 ? 'trend-down' : 'trend-flat'}`}>
                  {stats.aetTrend > 0 ? '↑' : stats.aetTrend < -0.5 ? '↓' : '→'} {Math.abs(stats.aetTrend).toFixed(1)} bpm/testi
                </span>
              )}
            </div>
          )}
          {stats.latestLT != null && (
            <div className="stat-card">
              <span className="label">Viimeisin LT2</span>
              <span className="big-value">{stats.latestLT} <small>bpm</small></span>
            </div>
          )}
          {stats.aetLtRatio != null && (
            <div className="stat-card">
              <span className="label">AeT / LT2</span>
              <span className="big-value">{(stats.aetLtRatio * 100).toFixed(0)}<small>%</small></span>
              <span className="trend trend-info">
                {stats.aetLtRatio > 0.85 ? 'Hyvin harjoiteltu' :
                 stats.aetLtRatio > 0.75 ? 'Hyvä aerobinen pohja' :
                 'Kehitettävää aerobisessa pohjassa'}
              </span>
            </div>
          )}
          <div className="stat-card">
            <span className="label">Analyysejä</span>
            <span className="big-value">{stats.totalAnalyses}</span>
          </div>
        </div>
      )}

      {/* Chart */}
      {entries.length >= 2 && <HistoryChart entries={entries} />}

      {/* Entry list */}
      {entries.length > 0 ? (
        <div className="history-list">
          <table>
            <thead>
              <tr>
                <th>Päivä</th>
                <th>Tiedosto</th>
                <th>Menetelmä</th>
                <th>AeT</th>
                <th>LT2</th>
                <th>Drifti</th>
                <th>DFA α1</th>
                <th>Lämpö</th>
                <th>Luottamus</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {[...entries].reverse().map(entry => (
                <tr key={entry.id}>
                  <td>{new Date(entry.date).toLocaleDateString('fi-FI')}</td>
                  <td className="file-name">{entry.fileName}</td>
                  <td>
                    <span className="method-badge">{methodLabel(entry.method)}</span>
                  </td>
                  <td className="hr-cell">{entry.aetHR ?? '—'}</td>
                  <td className="hr-cell">{entry.ltHR ?? '—'}</td>
                  <td>{entry.driftPercent != null ? `${entry.driftPercent.toFixed(1)}%` : '—'}</td>
                  <td>{entry.dfaAlpha1 != null ? entry.dfaAlpha1.toFixed(2) : '—'}</td>
                  <td>{entry.temperature != null ? `${entry.temperature.toFixed(0)}°C` : '—'}</td>
                  <td>
                    <span className={`badge badge-${confToLevel(entry.confidence)}`}>
                      {confLabel(entry.confidence)}
                    </span>
                  </td>
                  <td>
                    <button className="btn-remove" onClick={() => handleRemove(entry.id)} title="Poista">×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="info-box" style={{ marginTop: '2rem' }}>
          <h3>Ei vielä tallennettuja analyysejä</h3>
          <p>
            Analysoi suoritus yksittäisen tai monen tiedoston näkymässä ja tallenna tulos
            "Tallenna historiaan" -painikkeella. Ajan myötä näet kuinka aerobinen kynnyksesi kehittyy.
          </p>
        </div>
      )}
    </div>
  );
}

function HistoryChart({ entries }: { entries: HistoryEntry[] }) {
  const aetEntries = entries.filter(e => e.aetHR != null);
  const ltEntries = entries.filter(e => e.ltHR != null);

  const data = useMemo(() => {
    const labels = aetEntries.map(e => new Date(e.date).toLocaleDateString('fi-FI'));

    const datasets: any[] = [
      {
        label: 'AeT (bpm)',
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
        label: 'LT2 (bpm)',
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
  }, [aetEntries, ltEntries]);

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      title: { display: true, text: 'Kynnysarvojen kehitys', font: { size: 16 } },
      tooltip: {
        callbacks: {
          afterLabel: (ctx) => {
            const entry = aetEntries[ctx.dataIndex];
            const parts: string[] = [];
            if (entry.method) parts.push(`Menetelmä: ${methodLabel(entry.method)}`);
            if (entry.driftPercent != null) parts.push(`Drifti: ${entry.driftPercent.toFixed(1)}%`);
            if (entry.temperature != null) parts.push(`Lämpö: ${entry.temperature.toFixed(0)}°C`);
            return parts;
          },
        },
      },
    },
    scales: {
      y: { title: { display: true, text: 'Syke (bpm)' } },
    },
  };

  return (
    <div className="chart-container" style={{ height: '350px', marginBottom: '1.5rem' }}>
      <Line data={data} options={options} />
    </div>
  );
}

function methodLabel(method: string): string {
  switch (method) {
    case 'drift': return 'Drifti';
    case 'dfa-alpha1': return 'DFA α1';
    case 'combined': return 'Yhdistetty';
    case 'multi-file': return 'Moni-tiedosto';
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

function confLabel(conf: string): string {
  switch (conf) {
    case 'high': return 'Korkea';
    case 'medium': return 'Kohtal.';
    case 'low': return 'Matala';
    default: return conf;
  }
}
