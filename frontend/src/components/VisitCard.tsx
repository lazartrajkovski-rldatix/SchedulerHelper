import type { ScoredVisit } from '../types';

interface Props {
  result: ScoredVisit;
  rank: number;
  assignedNurseId?: number;          // nurse the USER has assigned
  onAssign?: (nurseId: number) => void; // called when a nurse pill is clicked
  isPostConflict?: boolean;           // flagged by real-time check after assignments
}

const RAG_STYLES = {
  Red:    { border: 'border-l-red-500',    bg: 'bg-red-50',    badge: 'bg-red-100 text-red-700' },
  Yellow: { border: 'border-l-yellow-400', bg: 'bg-yellow-50', badge: 'bg-yellow-100 text-yellow-700' },
  Green:  { border: 'border-l-green-500',  bg: 'bg-green-50',  badge: 'bg-green-100 text-green-700' },
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

export function VisitCard({ result, rank, assignedNurseId, onAssign, isPostConflict }: Props) {
  const { visit, isEligible, inBatch, ineligibilityReasons, eligibleClinicians, conflictsWith, suggestedNurseId } = result;
  const rag = RAG_STYLES[visit.ragStatus.name];
  const bandColor = BAND_COLORS[visit.bandId] ?? 'bg-gray-100 text-gray-700';

  // Ineligible — greyed out with reason
  if (!isEligible) {
    return (
      <div className="bg-gray-50 border border-dashed border-gray-300 rounded-lg p-3 opacity-60">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-400 w-5">—</span>
          <span className="text-sm text-gray-500 font-medium">{visit.patientName}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${bandColor}`}>{visit.band}</span>
          <span className="ml-auto text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded font-medium">Ineligible</span>
        </div>
        <div className="mt-1 text-xs text-red-400">{ineligibilityReasons.join(' · ')}</div>
      </div>
    );
  }

  // Outside batch — dimmed
  if (!inBatch) {
    return (
      <div className={`border-l-4 ${rag.border} bg-white border border-gray-200 rounded-lg p-3 opacity-40`}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-400 font-mono w-5">#{rank}</span>
          <span className="text-sm text-gray-600">{visit.patientName}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${bandColor}`}>{visit.band}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${rag.badge}`}>{visit.ragStatus.name}</span>
          <span className="text-xs text-gray-400">{visit.postcode}</span>
          <span className="ml-auto text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">Deferred</span>
        </div>
      </div>
    );
  }

  // In batch — full card
  const isAssigned = assignedNurseId !== undefined;
  const borderExtra = isPostConflict ? 'ring-2 ring-amber-400' : isAssigned ? 'ring-2 ring-green-400' : '';
  return (
    <div className={`border-l-4 ${rag.border} ${rag.bg} border border-gray-200 rounded-lg p-3 ${borderExtra}`}>
      {/* Row 1: identity */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-bold text-gray-400 font-mono w-5">#{rank}</span>
        <span className="font-semibold text-sm text-gray-800">{visit.patientName}</span>
        <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${bandColor}`}>{visit.band}</span>
        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${rag.badge}`}>{visit.ragStatus.name}</span>
        {visit.numberOfClinicians > 1 && (
          <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">
            ×{visit.numberOfClinicians} nurses
          </span>
        )}
        {isAssigned && (
          <span className="ml-auto text-xs bg-green-100 text-green-700 font-semibold px-2 py-0.5 rounded">
            ✓ Nurse assigned
          </span>
        )}
      </div>

      {/* Row 2: visit details */}
      {(() => {
        // Time label: fixed visits show exact time, flexible visits just say "Flexible"
        const slots = visit.timeSlots;
        let timeLabel: string;
        if (visit.treatmentTimeType === 'SpecificTime' || slots.length <= 1) {
          const start = slots[0] ? new Date(slots[0].from) : null;
          const end   = slots[0] ? new Date(slots[0].to)  : null;
          const fmt = (d: Date) => `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
          timeLabel = start && end ? `${fmt(start)} – ${fmt(end)} (fixed)` : visit.label;
        } else {
          // Flexible = no specific time required, nurse's shift hours are the real constraint
          timeLabel = 'Flexible (any time)';
        }
        return (
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600">
            <span>⏱ {visit.totalTime} min</span>
            <span>📍 {visit.postcode}</span>
            <span>🕐 {timeLabel}</span>
            <span className="text-gray-500">{visit.activities.map(a => a.name).join(', ')}</span>
          </div>
        );
      })()}

      {/* Row 3: nurse assignment pills */}
      {eligibleClinicians.length > 0 && (
        <div className="mt-2 flex gap-1 flex-wrap items-center">
          <span className="text-xs text-gray-400 mr-1">
            {onAssign ? 'Assign:' : 'Eligible:'}
          </span>
          {eligibleClinicians.map(c => {
            const isThisAssigned = assignedNurseId === c.id;
            const isThisSuggested = suggestedNurseId === c.id && !isAssigned;
            return (
              <button
                key={c.id}
                title={
                  isThisAssigned ? `Unassign ${c.name}` :
                  isThisSuggested ? `${c.name} — recommended by scheduler` :
                  `Assign ${c.name} · ${c.band}`
                }
                onClick={() => onAssign?.(c.id)}
                disabled={!onAssign}
                className={[
                  'text-xs px-2 py-0.5 rounded-full text-white font-medium transition-all',
                  onAssign ? 'cursor-pointer hover:opacity-80 active:scale-95' : 'cursor-default',
                  isThisAssigned ? 'ring-2 ring-green-400 ring-offset-1' : '',
                  isThisSuggested ? 'ring-2 ring-white ring-offset-1 ring-opacity-70' : '',
                ].join(' ')}
                style={{ backgroundColor: `#${c.clinicianColor}` }}
              >
                {c.name.split(' ')[0]}
                {isThisSuggested && ' ★'}
                {isThisAssigned && ' ✓'}
              </button>
            );
          })}
          {onAssign && !isAssigned && (
            <span className="text-xs text-gray-400 ml-1">★ = recommended</span>
          )}
          {isAssigned && onAssign && (
            <button
              onClick={() => onAssign(-1)}
              className="text-xs text-gray-400 hover:text-red-500 underline ml-2"
            >
              Unassign
            </button>
          )}
        </div>
      )}

      {/* Real-time conflict from user assignments */}
      {isPostConflict && (
        <div className="mt-2 bg-amber-50 border border-amber-400 rounded px-2 py-1.5 text-xs text-amber-800">
          <span className="font-bold">⚠ Now blocked</span> — your assignments have committed all eligible nurses for this visit.
          Free up a nurse or reassign another visit to resolve this.
        </div>
      )}

      {/* Simulation conflict warning */}
      {!isPostConflict && conflictsWith.length > 0 && (
        <div className="mt-2 bg-amber-50 border border-amber-300 rounded px-2 py-1.5 text-xs text-amber-800">
          <span className="font-bold">⚠ Cannot schedule — nurses are fully committed</span>
          <p className="mt-0.5">
            All eligible nurses are already assigned to:{' '}
            <span className="font-semibold">{conflictsWith.map(c => c.patientName).join(', ')}</span>
            {' '}at every available time slot. One of these visits will need to be rescheduled.
          </p>
        </div>
      )}
    </div>
  );
}
