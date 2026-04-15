import { useTranslation } from 'react-i18next';
import type { ActivitySummary } from '../lib/fitParser';
import { formatDuration, speedToPace } from '../lib/driftAnalysis';

interface ActivityInfoProps {
  activity: ActivitySummary;
}

export function ActivityInfo({ activity }: ActivityInfoProps) {
  const { t } = useTranslation();
  const avgSpeed = activity.totalDistance / activity.totalDuration;

  return (
    <div className="activity-info">
      <h2>{t('activity.heading')}</h2>
      <div className="info-grid">
        <div className="info-item">
          <span className="label">{t('activity.sport')}</span>
          <span className="value">{activity.sport}</span>
        </div>
        <div className="info-item">
          <span className="label">{t('activity.date')}</span>
          <span className="value">{activity.startTime.toLocaleDateString(t('common.dateLocale'))}</span>
        </div>
        <div className="info-item">
          <span className="label">{t('activity.distance')}</span>
          <span className="value">{(activity.totalDistance / 1000).toFixed(2)} km</span>
        </div>
        <div className="info-item">
          <span className="label">{t('activity.duration')}</span>
          <span className="value">{formatDuration(activity.totalDuration)}</span>
        </div>
        <div className="info-item">
          <span className="label">{t('activity.avgHr')}</span>
          <span className="value">{activity.avgHeartRate} {t('common.bpm')}</span>
        </div>
        <div className="info-item">
          <span className="label">{t('activity.avgPace')}</span>
          <span className="value">{speedToPace(avgSpeed)} /km</span>
        </div>
        {activity.hasTemperature && activity.avgTemperature != null && (
          <div className="info-item">
            <span className="label">{t('activity.temperature')}</span>
            <span className="value">{activity.avgTemperature.toFixed(0)}°C</span>
          </div>
        )}
        {activity.hasHRV && (
          <div className="info-item">
            <span className="label">{t('activity.hrvData')}</span>
            <span className="value data-badge data-yes">{activity.rrIntervals.length} {t('activity.beats')}</span>
          </div>
        )}
        {!activity.hasHRV && (
          <div className="info-item">
            <span className="label">{t('activity.hrvData')}</span>
            <span className="value data-badge data-no">{t('common.notAvailable')}</span>
          </div>
        )}
        {activity.hasPower && (
          <div className="info-item">
            <span className="label">{t('activity.runningPower')}</span>
            <span className="value data-badge data-yes">{t('common.available')}</span>
          </div>
        )}
        <div className="info-item">
          <span className="label">{t('activity.dataPoints')}</span>
          <span className="value">{activity.records.length}</span>
        </div>
      </div>
    </div>
  );
}
