import { prettyJson } from '../lib/stable';
import type { DetailPanelValue, DiffStatus } from '../types';

const STATUS_LABELS: Record<DiffStatus, string> = {
  changed: 'Changed',
  leftOnly: 'Left only',
  rightOnly: 'Right only',
  unchanged: 'Unchanged',
};

type Props = {
  detail?: DetailPanelValue;
  leftEnv: string;
  rightEnv: string;
};

export function DetailPanel({ detail, leftEnv, rightEnv }: Props) {
  if (!detail) {
    return (
      <div className="detail-panel detail-panel--empty">
        <h2>Details</h2>
        <p>Select a row to inspect its diff.</p>
      </div>
    );
  }

  return (
    <div className="detail-panel">
      <div className="detail-panel__header">
        <div>
          <h2>{detail.title}</h2>
          {detail.subtitle ? <p>{detail.subtitle}</p> : null}
        </div>
        <span className={`status-chip status-chip--${detail.status}`}>
          {STATUS_LABELS[detail.status]}
        </span>
      </div>

      {detail.changes.length ? (
        <div className="detail-panel__changes">
          <h3>Changed paths</h3>
          <ul>
            {detail.changes.map((change) => (
              <li key={`${change.kind}-${change.path}`}>
                <strong>{change.path}</strong>
                <span>{change.kind}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="detail-panel__payloads">
        <div>
          <h3>{leftEnv}</h3>
          <pre>{typeof detail.leftValue === 'undefined' ? 'Missing' : prettyJson(detail.leftValue)}</pre>
        </div>
        <div>
          <h3>{rightEnv}</h3>
          <pre>{typeof detail.rightValue === 'undefined' ? 'Missing' : prettyJson(detail.rightValue)}</pre>
        </div>
      </div>
    </div>
  );
}
