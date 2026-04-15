import { useTranslation } from 'react-i18next';
import type { DriftResult as DriftResultType } from '../lib/driftAnalysis';
import type { TemperatureCompensation } from '../lib/temperatureCompensation';
import { speedToPace, formatDuration } from '../lib/driftAnalysis';

interface DriftResultProps {
  result: DriftResultType;
  tempComp?: TemperatureCompensation | null;
}

export function DriftResultPanel({ result, tempComp }: DriftResultProps) {
  const { t } = useTranslation();

  const levelClass = {
    below: 'level-below',
    at: 'level-at',
    above: 'level-above',
  }[result.interpretation.level];

  return (
    <div className="drift-result">
      <h2>{t('drift.heading')}</h2>

      <div className={`interpretation ${levelClass}`}>
        <div className="interp-header">
          <span className="interp-badge">{result.interpretation.message}</span>
          <span className="interp-drift">
            {t('drift.gapDrift')} <strong>{result.gapDecouplingPercent.toFixed(1)}%</strong>
          </span>
        </div>
        <p>{result.interpretation.description}</p>
        {result.suggestedAeT && (
          <p className="suggested-aet">
            {t('drift.suggestedAeT')} <strong>{result.suggestedAeT} {t('common.bpm')}</strong>
          </p>
        )}
      </div>

      {tempComp && tempComp.applied && (
        <div className={`temp-comp temp-${tempComp.heatRisk}`}>
          <h4>{t('drift.temp.heading')}</h4>
          <div className="temp-grid">
            <div>
              <span className="label">{t('drift.temp.temperature')}</span>
              <span className="value">{tempComp.avgTemp.toFixed(0)}°C</span>
            </div>
            <div>
              <span className="label">{t('drift.temp.effect')}</span>
              <span className="value">+{tempComp.tempDriftComponent.toFixed(1)}%</span>
            </div>
            <div>
              <span className="label">{t('drift.temp.compensated')}</span>
              <span className="value">{tempComp.compensatedDrift.toFixed(1)}%</span>
            </div>
          </div>
          <p className="temp-explanation">{tempComp.explanation}</p>
        </div>
      )}

      {tempComp && !tempComp.applied && tempComp.avgTemp > 0 && (
        <div className="temp-info">
          {t('drift.temp.temperature')}: {tempComp.avgTemp.toFixed(0)}°C — {t('drift.temp.noEffect')}
        </div>
      )}

      <div className="drift-comparison">
        <h3>{t('drift.comparison.heading')}</h3>
        <table>
          <thead>
            <tr>
              <th></th>
              <th>{t('drift.comparison.first')}</th>
              <th>{t('drift.comparison.second')}</th>
              <th>{t('drift.comparison.change')}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{t('drift.comparison.hr')}</td>
              <td>{result.firstHalfAvgHR.toFixed(1)}</td>
              <td>{result.secondHalfAvgHR.toFixed(1)}</td>
              <td className={result.secondHalfAvgHR > result.firstHalfAvgHR ? 'change-up' : 'change-down'}>
                {result.secondHalfAvgHR > result.firstHalfAvgHR ? '+' : ''}
                {(result.secondHalfAvgHR - result.firstHalfAvgHR).toFixed(1)}
              </td>
            </tr>
            <tr>
              <td>{t('drift.comparison.pace')}</td>
              <td>{speedToPace(result.firstHalfAvgSpeed)}</td>
              <td>{speedToPace(result.secondHalfAvgSpeed)}</td>
              <td></td>
            </tr>
            <tr>
              <td>{t('drift.comparison.gapPace')}</td>
              <td>{speedToPace(result.firstHalfAvgGAP)}</td>
              <td>{speedToPace(result.secondHalfAvgGAP)}</td>
              <td></td>
            </tr>
            <tr>
              <td>{t('drift.comparison.efRaw')}</td>
              <td>{(result.firstHalfEF * 1000).toFixed(2)}</td>
              <td>{(result.secondHalfEF * 1000).toFixed(2)}</td>
              <td>{t('drift.comparison.driftPrefix')} {result.rawDecouplingPercent.toFixed(1)}%</td>
            </tr>
            <tr>
              <td>{t('drift.comparison.efGap')}</td>
              <td>{(result.firstHalfGapEF * 1000).toFixed(2)}</td>
              <td>{(result.secondHalfGapEF * 1000).toFixed(2)}</td>
              <td>{t('drift.comparison.driftPrefix')} {result.gapDecouplingPercent.toFixed(1)}%</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="drift-note">
        <p><strong>{t('drift.note.duration')}</strong> {formatDuration(result.analyzedDuration)}</p>
        <p className="explanation">{t('drift.note.explanation')}</p>
      </div>
    </div>
  );
}
