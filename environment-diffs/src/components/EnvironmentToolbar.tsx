import type { ProgressState } from '../types';

type Props = {
  environments: string[];
  leftEnv: string;
  rightEnv: string;
  onLeftEnvChange: (value: string) => void;
  onRightEnvChange: (value: string) => void;
  onRefresh: () => void;
  onCancel: () => void;
  isRunning: boolean;
  progress: ProgressState;
  error?: string;
};

export function EnvironmentToolbar({
  environments,
  leftEnv,
  rightEnv,
  onLeftEnvChange,
  onRightEnvChange,
  onRefresh,
  onCancel,
  isRunning,
  progress,
  error,
}: Props) {
  const percent =
    progress.total > 0 ? Math.min(100, Math.round((progress.current / progress.total) * 100)) : 0;

  return (
    <div className="env-toolbar">
      <div className="env-toolbar__controls">
        <label className="env-toolbar__field">
          <span>Left environment</span>
          <select
            value={leftEnv}
            onChange={(event) => onLeftEnvChange(event.target.value)}
          >
            {environments.map((environment) => (
              <option
                key={`left-${environment}`}
                value={environment}
                disabled={environment === rightEnv}
              >
                {environment}
              </option>
            ))}
          </select>
        </label>

        <label className="env-toolbar__field">
          <span>Right environment</span>
          <select
            value={rightEnv}
            onChange={(event) => onRightEnvChange(event.target.value)}
          >
            {environments.map((environment) => (
              <option
                key={`right-${environment}`}
                value={environment}
                disabled={environment === leftEnv}
              >
                {environment}
              </option>
            ))}
          </select>
        </label>

        <div className="env-toolbar__actions">
          <button className="toolbar-button" type="button" onClick={onRefresh}>
            Refresh
          </button>
          {isRunning ? (
            <button
              className="toolbar-button toolbar-button--secondary"
              type="button"
              onClick={onCancel}
            >
              Cancel
            </button>
          ) : null}
        </div>
      </div>

      <div className="env-toolbar__meta">
        <span>{isRunning ? `${percent}%` : 'Ready'}</span>
        <span>{error ?? progress.label}</span>
      </div>
    </div>
  );
}
