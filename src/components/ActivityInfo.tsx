import type { ActivitySummary } from '../lib/fitParser';
import { formatDuration, speedToPace } from '../lib/driftAnalysis';

interface ActivityInfoProps {
  activity: ActivitySummary;
}

export function ActivityInfo({ activity }: ActivityInfoProps) {
  const avgSpeed = activity.totalDistance / activity.totalDuration;

  return (
    <div className="activity-info">
      <h2>Aktiviteetti</h2>
      <div className="info-grid">
        <div className="info-item">
          <span className="label">Laji</span>
          <span className="value">{activity.sport}</span>
        </div>
        <div className="info-item">
          <span className="label">Päivämäärä</span>
          <span className="value">{activity.startTime.toLocaleDateString('fi-FI')}</span>
        </div>
        <div className="info-item">
          <span className="label">Matka</span>
          <span className="value">{(activity.totalDistance / 1000).toFixed(2)} km</span>
        </div>
        <div className="info-item">
          <span className="label">Kesto</span>
          <span className="value">{formatDuration(activity.totalDuration)}</span>
        </div>
        <div className="info-item">
          <span className="label">Kesk. syke</span>
          <span className="value">{activity.avgHeartRate} bpm</span>
        </div>
        <div className="info-item">
          <span className="label">Kesk. vauhti</span>
          <span className="value">{speedToPace(avgSpeed)} /km</span>
        </div>
        {activity.hasTemperature && activity.avgTemperature != null && (
          <div className="info-item">
            <span className="label">Lämpötila</span>
            <span className="value">{activity.avgTemperature.toFixed(0)}°C</span>
          </div>
        )}
        {activity.hasHRV && (
          <div className="info-item">
            <span className="label">HRV-data</span>
            <span className="value data-badge data-yes">{activity.rrIntervals.length} lyöntiä</span>
          </div>
        )}
        {!activity.hasHRV && (
          <div className="info-item">
            <span className="label">HRV-data</span>
            <span className="value data-badge data-no">Ei saatavilla</span>
          </div>
        )}
        {activity.hasPower && (
          <div className="info-item">
            <span className="label">Juoksuteho</span>
            <span className="value data-badge data-yes">Saatavilla</span>
          </div>
        )}
        <div className="info-item">
          <span className="label">Datapisteitä</span>
          <span className="value">{activity.records.length}</span>
        </div>
      </div>
    </div>
  );
}
