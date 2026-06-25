import type { ClinicConfig, ConstraintMode } from '../types';

interface Props {
  config: ClinicConfig;
  onChange: (config: ClinicConfig) => void;
}

type ConstraintKey = keyof ClinicConfig['constraints'];

const CONSTRAINT_META: Record<ConstraintKey, { label: string; desc: string }> = {
  bandMatch:         { label: 'Band Match',           desc: "Nurse's band must meet or exceed the visit's required band" },
  timeWindow:        { label: 'Time Window',           desc: "Visit must fall within a nurse's available shift hours" },
  nurseAvailability: { label: 'Nurse Availability',    desc: 'Nurse must not already be fully booked (mock threshold: 8 visits)' },
  mileageCap:        { label: 'Mileage Cap',           desc: "Visit must be reachable within the nurse's mileage limit" },
  patientContinuity: { label: 'Patient Continuity',    desc: "Patient's preferred nurse must be available for the visit" },
  urgency:           { label: 'Urgency (RAG Status)',  desc: 'Red visits score higher than Yellow; Yellow higher than Green' },
  bandEfficiency:    { label: 'Band Efficiency',       desc: 'Rewards a close band match — avoids wasting senior nurses on simple visits' },
  timeFlexibility:   { label: 'Time Flexibility',      desc: 'Visits with a fixed time score higher — schedule rigid ones first' },
  workloadBalance:   { label: 'Workload Balance',      desc: 'Favours visits that can go to nurses with fewer assignments today' },
};

const MODE_STYLES: Record<ConstraintMode, { active: string; inactive: string }> = {
  hard: { active: 'bg-red-500 text-white',    inactive: 'bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-600' },
  soft: { active: 'bg-blue-500 text-white',   inactive: 'bg-gray-100 text-gray-500 hover:bg-blue-50 hover:text-blue-600' },
  off:  { active: 'bg-gray-400 text-white',   inactive: 'bg-gray-100 text-gray-400 hover:bg-gray-200' },
};

const MODE_LABELS: Record<ConstraintMode, string> = {
  hard: 'Hard',
  soft: 'Soft',
  off:  'Off',
};

export function ConfigPage({ config, onChange }: Props) {
  const setMode = (key: ConstraintKey, mode: ConstraintMode) =>
    onChange({ ...config, constraints: { ...config.constraints, [key]: { ...config.constraints[key], mode } } });

  const setWeight = (key: ConstraintKey, weight: number) =>
    onChange({ ...config, constraints: { ...config.constraints, [key]: { ...config.constraints[key], weight } } });

  const hardCount = Object.values(config.constraints).filter(c => c.mode === 'hard').length;
  const softCount = Object.values(config.constraints).filter(c => c.mode === 'soft').length;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h2 className="text-lg font-bold text-gray-900">Constraint Configuration</h2>
        <p className="text-sm text-gray-500 mt-1">
          Set each constraint to <span className="font-semibold text-red-500">Hard</span> (must be satisfied — violations are flagged),{' '}
          <span className="font-semibold text-blue-500">Soft</span> (influences ranking score), or{' '}
          <span className="font-semibold text-gray-400">Off</span> (ignored).
        </p>
        <div className="flex gap-3 mt-3 text-xs text-gray-400">
          <span className="bg-red-50 text-red-600 px-2 py-0.5 rounded">{hardCount} Hard</span>
          <span className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded">{softCount} Soft</span>
          <span className="bg-gray-50 text-gray-400 px-2 py-0.5 rounded">
            {Object.keys(config.constraints).length - hardCount - softCount} Off
          </span>
        </div>
      </div>

      <div className="space-y-2">
        {(Object.keys(config.constraints) as ConstraintKey[]).map(key => {
          const setting = config.constraints[key];
          const meta = CONSTRAINT_META[key];

          return (
            <div
              key={key}
              className={`bg-white border rounded-lg p-4 transition-colors ${
                setting.mode === 'hard' ? 'border-red-200' :
                setting.mode === 'soft' ? 'border-blue-200' : 'border-gray-200'
              }`}
            >
              <div className="flex items-start gap-4">
                {/* Label + desc */}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-gray-800">{meta.label}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{meta.desc}</div>
                </div>

                {/* Mode selector */}
                <div className="flex rounded-lg overflow-hidden border border-gray-200 shrink-0">
                  {(['hard', 'soft', 'off'] as ConstraintMode[]).map(mode => (
                    <button
                      key={mode}
                      onClick={() => setMode(key, mode)}
                      className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                        setting.mode === mode ? MODE_STYLES[mode].active : MODE_STYLES[mode].inactive
                      }`}
                    >
                      {MODE_LABELS[mode]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Weight slider — only when Soft */}
              {setting.mode === 'soft' && (
                <div className="mt-3 flex items-center gap-3">
                  <span className="text-xs text-gray-400 w-14 shrink-0">Weight</span>
                  <input
                    type="range" min={0} max={100} value={setting.weight}
                    onChange={e => setWeight(key, parseInt(e.target.value))}
                    className="flex-1 accent-blue-500"
                  />
                  <span className="text-xs font-semibold text-blue-600 w-8 text-right tabular-nums">
                    {setting.weight}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

    </div>
  );
}
