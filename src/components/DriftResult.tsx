import type { DriftResult as DriftResultType } from '../lib/driftAnalysis';
import type { TemperatureCompensation } from '../lib/temperatureCompensation';
import { speedToPace, formatDuration } from '../lib/driftAnalysis';

interface DriftResultProps {
  result: DriftResultType;
  tempComp?: TemperatureCompensation | null;
}

export function DriftResultPanel({ result, tempComp }: DriftResultProps) {
  const levelClass = {
    below: 'level-below',
    at: 'level-at',
    above: 'level-above',
  }[result.interpretation.level];

  return (
    <div className="drift-result">
      <h2>Driftianalyysi</h2>

      <div className={`interpretation ${levelClass}`}>
        <div className="interp-header">
          <span className="interp-badge">{result.interpretation.message}</span>
          <span className="interp-drift">
            GAP-kompensoitu drifti: <strong>{result.gapDecouplingPercent.toFixed(1)}%</strong>
          </span>
        </div>
        <p>{result.interpretation.description}</p>
        {result.suggestedAeT && (
          <p className="suggested-aet">
            Arvioitu aerobinen kynnys (AeT): <strong>{result.suggestedAeT} bpm</strong>
          </p>
        )}
      </div>

      {/* Temperature compensation */}
      {tempComp && tempComp.applied && (
        <div className={`temp-comp temp-${tempComp.heatRisk}`}>
          <h4>Lämpötilakompensaatio</h4>
          <div className="temp-grid">
            <div>
              <span className="label">Lämpötila</span>
              <span className="value">{tempComp.avgTemp.toFixed(0)}°C</span>
            </div>
            <div>
              <span className="label">Lämpövaikutus</span>
              <span className="value">+{tempComp.tempDriftComponent.toFixed(1)}%</span>
            </div>
            <div>
              <span className="label">Kompensoitu drifti</span>
              <span className="value">{tempComp.compensatedDrift.toFixed(1)}%</span>
            </div>
          </div>
          <p className="temp-explanation">{tempComp.explanation}</p>
        </div>
      )}

      {tempComp && !tempComp.applied && tempComp.avgTemp > 0 && (
        <div className="temp-info">
          Lämpötila: {tempComp.avgTemp.toFixed(0)}°C — ei merkittävää lämpökompensaatiota tarvittu.
        </div>
      )}

      <div className="drift-comparison">
        <h3>Puoliskojen vertailu</h3>
        <table>
          <thead>
            <tr>
              <th></th>
              <th>1. puolisko</th>
              <th>2. puolisko</th>
              <th>Muutos</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Syke (bpm)</td>
              <td>{result.firstHalfAvgHR.toFixed(1)}</td>
              <td>{result.secondHalfAvgHR.toFixed(1)}</td>
              <td className={result.secondHalfAvgHR > result.firstHalfAvgHR ? 'change-up' : 'change-down'}>
                {result.secondHalfAvgHR > result.firstHalfAvgHR ? '+' : ''}
                {(result.secondHalfAvgHR - result.firstHalfAvgHR).toFixed(1)}
              </td>
            </tr>
            <tr>
              <td>Vauhti</td>
              <td>{speedToPace(result.firstHalfAvgSpeed)}</td>
              <td>{speedToPace(result.secondHalfAvgSpeed)}</td>
              <td></td>
            </tr>
            <tr>
              <td>GAP-vauhti</td>
              <td>{speedToPace(result.firstHalfAvgGAP)}</td>
              <td>{speedToPace(result.secondHalfAvgGAP)}</td>
              <td></td>
            </tr>
            <tr>
              <td>EF (raaka)</td>
              <td>{(result.firstHalfEF * 1000).toFixed(2)}</td>
              <td>{(result.secondHalfEF * 1000).toFixed(2)}</td>
              <td>Drifti: {result.rawDecouplingPercent.toFixed(1)}%</td>
            </tr>
            <tr>
              <td>EF (GAP)</td>
              <td>{(result.firstHalfGapEF * 1000).toFixed(2)}</td>
              <td>{(result.secondHalfGapEF * 1000).toFixed(2)}</td>
              <td>Drifti: {result.gapDecouplingPercent.toFixed(1)}%</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="drift-note">
        <p><strong>Analysoitu kesto:</strong> {formatDuration(result.analyzedDuration)}</p>
        <p className="explanation">
          EF (Efficiency Factor) = nopeus / syke. Kun EF laskee toisessa puoliskossa,
          syke on "driftannut" ylöspäin suhteessa vauhtiin. GAP-kompensoitu arvo huomioi
          maastonmuodot, joten mäkien vaikutus on normalisoitu.
        </p>
      </div>
    </div>
  );
}
