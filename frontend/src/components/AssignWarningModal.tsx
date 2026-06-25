import type { Clinician, ScoredVisit } from '../types';
import type { AssignmentCheck } from '../lib/assignmentCheck';

interface Props {
  nurse: Clinician;
  visit: ScoredVisit;
  check: AssignmentCheck;
  onConfirm: () => void;
  onCancel: () => void;
}

const ICON: Record<string, string> = {
  no_gap:          '⏳',
  time_overlap:    '🔴',
  busy_in_window:  '📅',
  travel_to:       '🚗',
  travel_from:     '🚗',
};

const LABEL: Record<string, string> = {
  no_gap:          'No available gap',
  time_overlap:    'Fixed-time clash',
  busy_in_window:  'Already busy during this window',
  travel_to:       'Travel from previous patient',
  travel_from:     'Can\'t reach next patient afterwards',
};

export function AssignWarningModal({ nurse, visit, check, onConfirm, onCancel }: Props) {
  const firstName   = nurse.name.split(' ')[0];
  const hasConflict = !check.feasible || check.wouldStrand.length > 0;

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`px-5 py-4 border-b ${hasConflict ? 'bg-red-50 border-red-100' : 'bg-blue-50 border-blue-100'}`}>
          <div className="flex items-center gap-2">
            <span
              className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-white text-sm font-bold"
              style={{ backgroundColor: `#${nurse.clinicianColor}` }}
            >
              {firstName[0]}
            </span>
            <div>
              <h2 className={`font-bold text-sm ${hasConflict ? 'text-red-800' : 'text-blue-800'}`}>
                {hasConflict
                  ? `⚠ Conflict: ${firstName} → ${visit.visit.patientName}`
                  : `Assign ${firstName} to ${visit.visit.patientName}`}
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {nurse.band} · {visit.visit.postcode} · {visit.visit.totalTime} min
              </p>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 space-y-4 max-h-[65vh] overflow-y-auto">

          {/* ── Conflicts ─────────────────────────────────── */}
          {check.conflicts.length > 0 && (
            <div>
              <div className="text-xs font-bold text-red-700 uppercase tracking-wide mb-2">
                Why {firstName} can't do this visit
              </div>
              <div className="space-y-2">
                {check.conflicts.map((c, i) => (
                  <div key={i} className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs">
                    <div className="font-semibold text-red-700 flex items-center gap-1.5">
                      <span>{ICON[c.type]}</span>
                      <span>{LABEL[c.type]}</span>
                    </div>
                    <div className="text-red-600 mt-0.5">{c.detail}</div>
                    {c.bullets && c.bullets.length > 0 && (
                      <ul className="mt-1.5 space-y-1 border-t border-red-200 pt-1.5">
                        {c.bullets.map((b, bi) => (
                          <li key={bi} className="flex gap-1.5 text-red-500">
                            <span className="shrink-0 mt-0.5">›</span>
                            <span>{b}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Feasible confirmation ─────────────────────── */}
          {check.feasible && check.conflicts.length === 0 && (
            <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-xs text-green-800">
              ✓ {firstName} can make it to this visit.
              {check.nurseSchedule.length === 0 && ' They have no other visits today.'}
            </div>
          )}

          {/* ── Nurse's current schedule ──────────────────── */}
          {check.nurseSchedule.length > 0 && (
            <div>
              <div className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
                {firstName}'s current schedule ({check.nurseSchedule.length} visit{check.nurseSchedule.length !== 1 ? 's' : ''})
              </div>
              <div className="space-y-1">
                {check.nurseSchedule.map((s, i) => (
                  <div
                    key={i}
                    className="bg-gray-50 border border-gray-200 rounded px-3 py-1.5 text-xs flex items-center gap-2"
                  >
                    <span className="font-mono text-gray-500 w-20 shrink-0">{s.timeRange}</span>
                    <span className="font-semibold text-gray-800">{s.patientName}</span>
                    <span className="text-gray-400 ml-auto">{s.postcode}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Would strand other patients ───────────────── */}
          {check.wouldStrand.length > 0 && (
            <div className="bg-amber-50 border border-amber-300 rounded-lg px-3 py-2.5 text-xs text-amber-900">
              <div className="font-bold mb-1">
                ⚠ {firstName} is the ONLY nurse who can do:
              </div>
              <ul className="space-y-0.5 list-disc list-inside text-amber-800">
                {check.wouldStrand.map(s => (
                  <li key={s.treatmentId}>
                    {s.patientName} — would have <strong>no nurse</strong> if you reassign {firstName}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-amber-700">
                You can still override, but you'll need to manually handle{' '}
                {check.wouldStrand.length === 1 ? 'that visit' : 'those visits'} separately.
              </p>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 flex items-center gap-2">
          <span className="text-xs text-gray-400 flex-1">
            {hasConflict
              ? 'You can override — but check the Nurse Day Plan for red travel blocks.'
              : 'This assignment is safe.'}
          </span>
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 text-sm text-white rounded-lg font-medium transition-colors ${
              hasConflict
                ? 'bg-red-500 hover:bg-red-600'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {hasConflict ? `Override — assign ${firstName}` : `Assign ${firstName}`}
          </button>
        </div>
      </div>
    </div>
  );
}
