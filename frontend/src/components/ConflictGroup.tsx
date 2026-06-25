import type { ScoredVisit } from '../types';

const RAG_BADGE: Record<string, string> = {
  Red:    'bg-red-100 text-red-700',
  Yellow: 'bg-yellow-100 text-yellow-700',
  Green:  'bg-green-100 text-green-700',
};

const BAND_COLORS: Record<number, string> = {
  1: 'bg-emerald-100 text-emerald-800',
  2: 'bg-teal-100 text-teal-800',
  3: 'bg-cyan-100 text-cyan-800',
  4: 'bg-blue-100 text-blue-800',
  5: 'bg-indigo-100 text-indigo-800',
  6: 'bg-violet-100 text-violet-800',
  7: 'bg-purple-100 text-purple-800',
  8: 'bg-fuchsia-100 text-fuchsia-800',
  9: 'bg-pink-100 text-pink-800',
};

interface Props {
  group: ScoredVisit[];
  chosenId: number | undefined;
  onChoose: (treatmentId: number) => void;
}

export function ConflictGroup({ group, chosenId, onChoose }: Props) {
  const isResolved = chosenId !== undefined;

  return (
    <div className={`rounded-lg border-2 p-4 ${isResolved ? 'border-gray-200 bg-gray-50' : 'border-amber-400 bg-amber-50'}`}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        {isResolved ? (
          <span className="text-sm text-gray-500 font-medium">✓ Conflict resolved</span>
        ) : (
          <>
            <span className="text-amber-600 font-bold text-sm">⚠ Scheduling conflict</span>
            <span className="text-xs text-amber-700">
              — these visits compete for the same nurse(s). Choose which one to do today.
              The other will be rescheduled.
            </span>
          </>
        )}
      </div>

      {/* Visit cards side by side */}
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${group.length}, 1fr)` }}>
        {group.map(sv => {
          const isChosen = sv.visit.treatmentId === chosenId;
          const isRejected = isResolved && !isChosen;
          const bandColor = BAND_COLORS[sv.visit.bandId] ?? 'bg-gray-100 text-gray-700';
          const ragBadge  = RAG_BADGE[sv.visit.ragStatus.name] ?? '';

          return (
            <div
              key={sv.visit.treatmentId}
              className={`rounded-lg border p-3 flex flex-col gap-2 transition-all ${
                isChosen
                  ? 'bg-green-50 border-green-400'
                  : isRejected
                    ? 'bg-gray-100 border-gray-200 opacity-50'
                    : 'bg-white border-gray-200'
              }`}
            >
              {/* Status badge */}
              {isChosen && (
                <div className="text-xs font-bold text-green-700 bg-green-100 rounded px-2 py-0.5 w-fit">
                  ✓ Will be done today
                </div>
              )}
              {isRejected && (
                <div className="text-xs font-bold text-gray-500 bg-gray-200 rounded px-2 py-0.5 w-fit">
                  ↷ Rescheduled
                </div>
              )}

              {/* Visit info */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-semibold text-sm text-gray-800">{sv.visit.patientName}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${bandColor}`}>{sv.visit.band}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${ragBadge}`}>{sv.visit.ragStatus.name}</span>
                {sv.visit.numberOfClinicians > 1 && (
                  <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">
                    ×{sv.visit.numberOfClinicians} nurses
                  </span>
                )}
              </div>

              <div className="text-xs text-gray-600 flex flex-wrap gap-x-3 gap-y-0.5">
                <span>⏱ {sv.visit.totalTime} min</span>
                <span>📍 {sv.visit.postcode}</span>
                <span>🕐 {sv.visit.label}</span>
              </div>

              <div className="text-xs text-gray-400">
                {sv.visit.activities.map(a => a.name).join(', ')}
              </div>

              {/* Eligible nurses */}
              {sv.eligibleClinicians.length > 0 && (
                <div className="flex gap-1 flex-wrap items-center">
                  <span className="text-xs text-gray-400">Eligible:</span>
                  {sv.eligibleClinicians.map(c => (
                    <span
                      key={c.id}
                      className="text-xs px-1.5 py-0.5 rounded-full text-white font-medium"
                      style={{ backgroundColor: `#${c.clinicianColor}` }}
                    >
                      {c.name.split(' ')[0]}
                    </span>
                  ))}
                </div>
              )}

              {/* Choose button — only shown when unresolved */}
              {!isResolved && (
                <button
                  onClick={() => onChoose(sv.visit.treatmentId)}
                  className="mt-auto w-full bg-gray-900 hover:bg-gray-700 text-white text-xs font-semibold rounded py-1.5 transition-colors"
                >
                  Do this visit today →
                </button>
              )}

              {/* Undo button — only shown on chosen card */}
              {isChosen && (
                <button
                  onClick={() => onChoose(-1)}
                  className="text-xs text-gray-400 hover:text-gray-600 underline text-center"
                >
                  Undo choice
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
