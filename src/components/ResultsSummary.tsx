import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface ResultsSummaryProps {
  hasDFA: boolean;
}

export function ResultsSummary({ hasDFA }: ResultsSummaryProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="results-guide">
      <div className="results-guide-header" onClick={() => setExpanded(!expanded)}>
        <h3>{t('results.guide.heading')}</h3>
        <button className="guide-toggle">
          {expanded ? t('results.guide.toggle.hide') : t('results.guide.toggle.show')}
        </button>
      </div>

      {expanded && (
        <div className="results-guide-body">
          <p className="guide-overview">{t('results.guide.overview')}</p>

          <div className="guide-sections">
            <div className="guide-section">
              <span className="guide-section-badge guide-badge-drift">1</span>
              <div>
                <strong>{t('results.guide.sections.drift.title')}</strong>
                <p>{t('results.guide.sections.drift.text')}</p>
              </div>
            </div>

            {hasDFA && (
              <div className="guide-section">
                <span className="guide-section-badge guide-badge-dfa">2</span>
                <div>
                  <strong>{t('results.guide.sections.dfa.title')}</strong>
                  <p>{t('results.guide.sections.dfa.text')}</p>
                </div>
              </div>
            )}

            {hasDFA && (
              <div className="guide-section">
                <span className="guide-section-badge guide-badge-cv">↔</span>
                <div>
                  <strong>{t('results.guide.sections.crossval.title')}</strong>
                  <p>{t('results.guide.sections.crossval.text')}</p>
                </div>
              </div>
            )}

            <div className="guide-section">
              <span className="guide-section-badge guide-badge-diag">✓</span>
              <div>
                <strong>{t('results.guide.sections.diagnostics.title')}</strong>
                <p>{t('results.guide.sections.diagnostics.text')}</p>
              </div>
            </div>
          </div>

          <div className="guide-reading">
            <strong>{t('results.guide.reading.heading')}</strong>
            <div className="guide-color-legend">
              <span className="guide-color-item guide-color-below">{t('results.guide.reading.below')}</span>
              <span className="guide-color-item guide-color-at">{t('results.guide.reading.at')}</span>
              <span className="guide-color-item guide-color-above">{t('results.guide.reading.above')}</span>
            </div>
          </div>

          <p className="guide-linked">{t('results.guide.linked')}</p>
        </div>
      )}
    </div>
  );
}
