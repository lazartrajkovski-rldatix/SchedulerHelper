import { useState, useMemo } from 'react';
import type { ScoredVisit, Clinician } from '../types';
import { VisitCard } from './VisitCard';
import { NurseDayPlan } from './NurseDayPlan';
import { AssignWarningModal } from './AssignWarningModal';
import { checkAssignment } from '../lib/assignmentCheck';

interface Props {
  results: ScoredVisit[];
  clinicians: Clinician[];
}

function StatCard({ label, value, sub, color }: { label: string; value: number | string; sub?: string; color: 'gray' | 'blue' | 'green' | 'red' | 'amber' }) {
  const styles = {
    gray:  'bg-gray-50 border-gray-200 text-gray-700',
    blue:  'bg-blue-50 border-blue-200 text-blue-700',
    green: 'bg-green-50 border-green-200 text-green-700',
    red:   'bg-red-50 border-red-200 text-red-700',
    amber: 'bg-amber-50 border-amber-300 text-amber-700',
  };
  return (
    <div className={`rounded-lg border p-3 ${styles[color]}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs mt-0.5 opacity-70">{label}</div>
      {sub && <div className="text-xs mt-0.5 opacity-50">{sub}</div>}
    </div>
  );
}

function NurseCapacityBar({ nurse, assignedMinutes, shiftMinutes }: { nurse: Clinician; assignedMinutes: number; shiftMinutes: number }) {
  const pct = Math.min(100, Math.round((assignedMinutes / shiftMinutes) * 100));
  const barColor =
    pct >= 90 ? 'bg-red-500' :
    pct >= 70 ? 'bg-amber-400' :
    pct >= 40 ? 'bg-blue-400' :
    'bg-green-400';
  const label =
    pct >= 90 ? 'At risk of overload' :
    pct >= 70 ? 'Busy day' :
    pct >= 40 ? 'Moderate load' :
    'Light load';

  return (
    <div className="flex items-center gap-3">
      <span
        className="text-xs font-medium text-white px-2 py-0.5 rounded-full whitespace-nowrap"
        style={{ backgroundColor: `#${nurse.clinicianColor}` }}
      >
        {nurse.name.split(' ')[0]}
      </span>
      <span className="text-xs text-gray-400 w-16 whitespace-nowrap">{nurse.band.replace('District Nurse ', '')}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
        <div className={`h-2 rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-500 whitespace-nowrap w-28">{assignedMinutes}/{shiftMinutes} min</span>
      <span className={`text-xs whitespace-nowrap ${pct >= 90 ? 'text-red-500 font-semibold' : pct >= 70 ? 'text-amber-600' : 'text-gray-400'}`}>{label}</span>
    </div>
  );
}

export function BatchResults({ results, clinicians }: Props) {
  // assignments: treatmentId → nurseId (manual overrides by user)
  const [assignments, setAssignments] = useState<Map<number, number>>(new Map());

  // Modal state: pending assignment awaiting user confirmation
  const [pendingAssignment, setPendingAssignment] = useState<{
    treatmentId: number;
    nurseId: number;
    sv: ScoredVisit;
  } | null>(null);

  // Commit an assignment (called immediately if safe, or after user confirms in modal)
  const commitAssign = (treatmentId: number, nurseId: number) => {
    setAssignments(prev => {
      const next = new Map(prev);
      if (nurseId === -1 || next.get(treatmentId) === nurseId) {
        next.delete(treatmentId);
      } else {
        next.set(treatmentId, nurseId);
      }
      return next;
    });
  };

  // Intercept nurse-pill clicks: run feasibility check, show modal if there's any issue
  const handleAssignClick = (treatmentId: number, nurseId: number, sv: ScoredVisit) => {
    // Unassign: do immediately, no modal needed
    if (nurseId === -1 || assignments.get(treatmentId) === nurseId) {
      commitAssign(treatmentId, nurseId);
      return;
    }
    // Confirming the simulation's recommendation: trust the scheduler, assign directly
    if (nurseId === sv.suggestedNurseId) {
      commitAssign(treatmentId, nurseId);
      return;
    }
    // Override (different nurse): always show modal so user sees the impact
    setPendingAssignment({ treatmentId, nurseId, sv });
  };

  // ── Unified live categorization ──────────────────────────────────
  // Every eligible visit falls into exactly one bucket based on the current
  // effective assignment (manual override OR simulation suggestion):
  //
  //   cleanVisits   — has a nurse, no time collision in that nurse's timeline
  //   brokenVisits  — has a nurse, but that nurse is double-booked at that time
  //   noNurseVisits — no nurse at all (simulation couldn't place AND no manual assignment)
  //
  // This replaces the old postAssignmentConflicts check, which only looked at
  // non-manually-assigned visits and missed the case where the user force-assigned
  // one nurse to a dozen overlapping visits.

  const eligible   = results.filter(r => r.isEligible);
  const ineligible = results.filter(r => !r.isEligible);

  const { cleanVisits, brokenVisits, noNurseVisits } = useMemo(() => {
    // ── Phase 1: build a timeline from MANUAL assignments only ──────────────
    // These represent the user's explicit decisions and have priority over
    // simulation suggestions.
    const manualTimeline = new Map<number, Array<{ from: number; until: number; tid: number }>>();

    for (const sv of eligible) {
      const nurseId = assignments.get(sv.visit.treatmentId);
      if (nurseId === undefined) continue;

      const slotFrom = sv.suggestedSlotFrom ?? sv.visit.timeSlots[0]?.from;
      if (!slotFrom) continue;

      const from  = new Date(slotFrom).getTime();
      const until = from + sv.visit.totalTime * 60_000;
      if (!manualTimeline.has(nurseId)) manualTimeline.set(nurseId, []);
      manualTimeline.get(nurseId)!.push({ from, until, tid: sv.visit.treatmentId });
    }

    // ── Phase 2: find user-created double-bookings (manual vs manual) ───────
    // Both manual assignments are shown as broken — the user conflicted themselves.
    const manualConflictIds = new Set<number>();
    for (const [, blocks] of manualTimeline) {
      for (let i = 0; i < blocks.length; i++) {
        for (let j = i + 1; j < blocks.length; j++) {
          const a = blocks[i], b = blocks[j];
          if (a.from < b.until && a.until > b.from) {
            manualConflictIds.add(a.tid);
            manualConflictIds.add(b.tid);
          }
        }
      }
    }

    // ── Phase 3: find suggestions invalidated by manual assignments ─────────
    // e.g. Cillian was ★ for Marcus Reed, but user manually sent Cillian to
    // Sarah Johnson — Marcus Reed now has NO valid nurse (goes to ⚠ Needs decision).
    const invalidatedIds = new Set<number>();
    for (const sv of eligible) {
      if (assignments.has(sv.visit.treatmentId)) continue; // manual — skip
      if (!sv.suggestedNurseId || !sv.suggestedSlotFrom) continue;

      const manualBlocks = manualTimeline.get(sv.suggestedNurseId) ?? [];
      const from  = new Date(sv.suggestedSlotFrom).getTime();
      const until = from + sv.visit.totalTime * 60_000;

      if (manualBlocks.some(b => from < b.until && until > b.from)) {
        invalidatedIds.add(sv.visit.treatmentId);
      }
    }

    // ── Phase 4: find suggestion-vs-suggestion conflicts ────────────────────
    // (Scheduler plan has two visits at the same time for the same nurse.)
    // Only check visits that aren't already invalidated.
    const suggTimeline = new Map<number, Array<{ from: number; until: number; tid: number }>>();
    for (const sv of eligible) {
      if (assignments.has(sv.visit.treatmentId)) continue;
      if (invalidatedIds.has(sv.visit.treatmentId)) continue;
      if (!sv.suggestedNurseId || !sv.suggestedSlotFrom) continue;

      const from  = new Date(sv.suggestedSlotFrom).getTime();
      const until = from + sv.visit.totalTime * 60_000;
      if (!suggTimeline.has(sv.suggestedNurseId)) suggTimeline.set(sv.suggestedNurseId, []);
      suggTimeline.get(sv.suggestedNurseId)!.push({ from, until, tid: sv.visit.treatmentId });
    }
    const suggConflictIds = new Set<number>();
    for (const [, blocks] of suggTimeline) {
      for (let i = 0; i < blocks.length; i++) {
        for (let j = i + 1; j < blocks.length; j++) {
          const a = blocks[i], b = blocks[j];
          if (a.from < b.until && a.until > b.from) {
            suggConflictIds.add(a.tid);
            suggConflictIds.add(b.tid);
          }
        }
      }
    }

    // ── Phase 5: categorise ─────────────────────────────────────────────────
    const clean:   ScoredVisit[] = [];
    const broken:  ScoredVisit[] = [];
    const noNurse: ScoredVisit[] = [];

    for (const sv of eligible) {
      const tid      = sv.visit.treatmentId;
      const isManual = assignments.has(tid);

      if (isManual) {
        // User chose this nurse — only broken if they conflicted two manual picks
        manualConflictIds.has(tid) ? broken.push(sv) : clean.push(sv);
      } else if (invalidatedIds.has(tid)) {
        // Scheduler's suggested nurse was manually taken elsewhere → stranded
        noNurse.push(sv);
      } else if (!sv.suggestedNurseId) {
        noNurse.push(sv);
      } else if (suggConflictIds.has(tid)) {
        broken.push(sv);
      } else {
        clean.push(sv);
      }
    }

    return { cleanVisits: clean, brokenVisits: broken, noNurseVisits: noNurse };
  }, [eligible, assignments]);

  // Live counts
  const liveCanDo       = cleanVisits.length;
  const liveNeedsAction = noNurseVisits.length + brokenVisits.length;
  const doablePct       = eligible.length === 0 ? 0 : Math.round((liveCanDo / eligible.length) * 100);

  // ── Adjust slot times for manual overrides ───────────────────────────────
  // When a user assigns a visit to a DIFFERENT nurse than the scheduler suggested,
  // the scheduler's suggestedSlotFrom is for the old nurse (wrong shift, wrong location).
  // We recompute a valid slot time for the manually assigned nurse so that:
  //   • NurseDayPlan shows the visit at the correct time in Dell's card
  //   • Travel blocks are calculated correctly
  const adjustedResults = useMemo(() => {
    if (assignments.size === 0) return results;

    return results.map(sv => {
      const manualNurseId = assignments.get(sv.visit.treatmentId);
      // Only fix visits where the manual nurse differs from the suggestion
      if (!manualNurseId || manualNurseId === sv.suggestedNurseId) return sv;

      const nurse = clinicians.find(n => n.id === manualNurseId);
      if (!nurse) return sv;

      let newSlotFrom: string | null = sv.suggestedSlotFrom;

      if (sv.visit.treatmentTimeType === 'SpecificTime') {
        // Fixed time — always correct regardless of nurse
        newSlotFrom = sv.visit.timeSlots[0]?.from ?? sv.suggestedSlotFrom;
      } else {
        // Flexible — find the first hourly slot that fits within this nurse's shift
        const shiftStart = nurse.availabilities[0]?.actual.startDate
          ? new Date(nurse.availabilities[0].actual.startDate).getTime() : 0;
        const shiftEnd = nurse.availabilities[0]?.actual.endDate
          ? new Date(nurse.availabilities[0].actual.endDate).getTime() : Infinity;
        const durMs = sv.visit.totalTime * 60_000;

        const validSlot = sv.visit.timeSlots.find(s => {
          const from = new Date(s.from).getTime();
          return from >= shiftStart && from + durMs <= shiftEnd;
        });
        newSlotFrom = validSlot?.from ?? sv.suggestedSlotFrom;
      }

      return { ...sv, suggestedNurseId: manualNurseId, suggestedSlotFrom: newSlotFrom };
    });
  }, [results, assignments, clinicians]);

  // Per-nurse workload — only count clean (non-conflicted) visits
  const nurseLoad = useMemo(() => {
    const map = new Map<number, { nurse: Clinician; assignedMinutes: number; shiftMinutes: number }>();
    clinicians.forEach(n => {
      const shiftMinutes = n.availabilities.reduce((sum, a) =>
        sum + (new Date(a.actual.endDate).getTime() - new Date(a.actual.startDate).getTime()) / 60000, 0);
      map.set(n.id, { nurse: n, assignedMinutes: 0, shiftMinutes: shiftMinutes || 960 });
    });
    for (const sv of cleanVisits) {
      const nurseId = assignments.get(sv.visit.treatmentId) ?? sv.suggestedNurseId;
      if (nurseId !== null) {
        const e = map.get(nurseId);
        if (e) e.assignedMinutes += sv.visit.totalTime;
      }
    }
    return [...map.values()].sort((a, b) => b.assignedMinutes - a.assignedMinutes);
  }, [cleanVisits, assignments, clinicians]);

  // ── Finalized flag ────────────────────────────────────────────────────────
  const [finalized, setFinalized] = useState(false);

  // Confirm all scheduler recommendations in one click
  const confirmAll = () => {
    setAssignments(prev => {
      const next = new Map(prev);
      for (const sv of cleanVisits) {
        if (sv.suggestedNurseId !== null && !next.has(sv.visit.treatmentId)) {
          next.set(sv.visit.treatmentId, sv.suggestedNurseId);
        }
      }
      return next;
    });
    setFinalized(true);
  };

  const resetAll = () => {
    setAssignments(new Map());
    setFinalized(false);
  };

  const allConfirmed = cleanVisits.length > 0 && cleanVisits.every(sv =>
    assignments.has(sv.visit.treatmentId)
  );

  return (
    <div className="flex-1 min-w-0 space-y-5">

      {/* ── Assignment warning modal ───────────── */}
      {pendingAssignment && (() => {
        const nurse = clinicians.find(c => c.id === pendingAssignment.nurseId);
        if (!nurse) return null;
        const check = checkAssignment(pendingAssignment.nurseId, pendingAssignment.sv, assignments, results);
        return (
          <AssignWarningModal
            nurse={nurse}
            visit={pendingAssignment.sv}
            check={check}
            onConfirm={() => {
              commitAssign(pendingAssignment.treatmentId, pendingAssignment.nurseId);
              setPendingAssignment(null);
            }}
            onCancel={() => setPendingAssignment(null)}
          />
        );
      })()}

      {/* ── Stats ─────────────────────────────── */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard
          label="Total visits today"
          value={results.length}
          sub={`${eligible.length} eligible · ${ineligible.length} flagged`}
          color="gray"
        />
        <StatCard
          label="Can be done today"
          value={`${liveCanDo} of ${eligible.length}`}
          sub={brokenVisits.length > 0
            ? `⚠ ${brokenVisits.length} visit${brokenVisits.length !== 1 ? 's' : ''} now double-booked`
            : `${doablePct}% of eligible visits`}
          color={doablePct >= 80 ? 'green' : doablePct >= 50 ? 'blue' : 'amber'}
        />
        <StatCard
          label="Needs decision"
          value={liveNeedsAction}
          sub={brokenVisits.length > 0
            ? `${noNurseVisits.length} unplaced · ${brokenVisits.length} now double-booked`
            : noNurseVisits.length > 0 ? 'Nurse busy or travel too long — see below' : 'All eligible visits scheduled'}
          color={liveNeedsAction > 0 ? 'amber' : 'gray'}
        />
        <StatCard
          label="Can't be done today"
          value={ineligible.length}
          sub={ineligible.length > 0 ? 'Hard constraint violation — see below' : 'No hard-gate failures'}
          color={ineligible.length > 0 ? 'red' : 'gray'}
        />
      </div>

      {/* ── Nurse workload ────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
          Nurse workload — how much of each shift is committed to visits
        </h3>
        <p className="text-xs text-gray-400 mb-3">
          The bar shows scheduled visit minutes as a % of total shift length.
          A nurse at 80%+ is at risk of running late — travel time between patients will push them over.
          {assignments.size > 0 && ' Workload reflects your manual overrides.'}
        </p>
        <div className="space-y-2">
          {nurseLoad.map(({ nurse, assignedMinutes, shiftMinutes }) => (
            <NurseCapacityBar
              key={nurse.id}
              nurse={nurse}
              assignedMinutes={assignedMinutes}
              shiftMinutes={shiftMinutes}
            />
          ))}
        </div>
      </div>

      {/* ── Nurse day plan ────────────────────── */}
      <NurseDayPlan results={adjustedResults} clinicians={clinicians} assignments={assignments} />

      {/* ── Finalize / final schedule banner ────── */}
      {allConfirmed || finalized ? (
        <div className="bg-green-50 border border-green-300 rounded-xl p-5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="text-base font-bold text-green-800">
                ✅ Day schedule finalised — {assignments.size} visits confirmed
              </div>
              <div className="text-xs text-green-600 mt-1">
                All recommendations locked in. The nurse day plan above shows the full route for each nurse.
                {noNurseVisits.length > 0 && ` ${noNurseVisits.length} visit${noNurseVisits.length !== 1 ? 's' : ''} could not be placed — see ⚠ Needs decision below.`}
              </div>
            </div>
            <button
              onClick={resetAll}
              className="text-xs px-3 py-1.5 rounded-lg border border-green-400 text-green-700 hover:bg-green-100 transition-colors"
            >
              ↩ Reset all assignments
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-blue-800">Ready to finalise the day?</div>
            <div className="text-xs text-blue-600 mt-0.5">
              {assignments.size > 0
                ? `You have ${assignments.size} manual assignment${assignments.size !== 1 ? 's' : ''}. Click to confirm the remaining ${cleanVisits.length - assignments.size > 0 ? cleanVisits.length - assignments.size : cleanVisits.length} ★ suggestions.`
                : `Click to confirm all ${cleanVisits.length} ★ scheduler recommendations at once.`}
            </div>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            {assignments.size > 0 && (
              <button
                onClick={resetAll}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors"
              >
                Reset
              </button>
            )}
            <button
              onClick={confirmAll}
              disabled={cleanVisits.length === 0}
              className="text-sm px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors disabled:opacity-40"
            >
              Confirm all ★ &amp; view final schedule
            </button>
          </div>
        </div>
      )}

      {/* ── Planner sections (hidden after finalising) ────────────────── */}
      {!finalized && (
        <>
          {/* ── Ready to assign ───────────────────── */}
          <div>
            <h3 className="font-semibold text-gray-700 mb-1">
              ✓ Ready to assign — {cleanVisits.length} visit{cleanVisits.length !== 1 ? 's' : ''}
            </h3>
            <p className="text-xs text-gray-400 mb-3">
              Suggested nurse (★) can be confirmed with one click. Clicking a different nurse opens a conflict check first.
            </p>
            <div className="space-y-2">
              {cleanVisits.length === 0 && (
                <p className="text-sm text-gray-400 italic">No conflict-free visits — undo some overrides or reassign below.</p>
              )}
              {cleanVisits.map((r, i) => (
                <VisitCard
                  key={`${r.visit.treatmentId}-ready`}
                  result={r}
                  rank={i + 1}
                  assignedNurseId={assignments.get(r.visit.treatmentId)}
                  onAssign={id => handleAssignClick(r.visit.treatmentId, id, r)}
                  isPostConflict={false}
                />
              ))}
            </div>
          </div>

          {/* ── Double-booked / broken visits ────── */}
          {brokenVisits.length > 0 && (
            <div>
              <h3 className="font-semibold text-red-600 mb-1">
                🔴 Now unschedulable — {brokenVisits.length} visit{brokenVisits.length !== 1 ? 's' : ''} with a double-booked nurse
              </h3>
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 mb-3 text-xs text-red-700">
                The nurse assigned to {brokenVisits.length === 1 ? 'this visit' : 'these visits'} is also assigned to
                another visit at the same time — they can't be in two places at once. Click the nurse pill to unassign
                and try a different nurse, or unassign one of the other visits where they appear.
              </div>
              <div className="space-y-2">
                {brokenVisits.map((r, i) => (
                  <div key={`${r.visit.treatmentId}-broken`} className="rounded-lg border-2 border-red-400 overflow-hidden">
                    <div className="bg-red-100 px-3 py-2 text-xs text-red-800 font-semibold flex items-center gap-2">
                      <span>⚠ Double-booked:</span>
                      <span className="font-normal">
                        {(() => {
                          const nurseId = assignments.get(r.visit.treatmentId) ?? r.suggestedNurseId;
                          const nurse = clinicians.find(c => c.id === nurseId);
                          return nurse ? `${nurse.name} is assigned to another visit at the same time` : 'Nurse is double-booked';
                        })()}
                      </span>
                    </div>
                    <VisitCard
                      result={r}
                      rank={cleanVisits.length + i + 1}
                      assignedNurseId={assignments.get(r.visit.treatmentId)}
                      onAssign={id => handleAssignClick(r.visit.treatmentId, id, r)}
                      isPostConflict={true}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Needs decision (no nurse) ─────────── */}
          {noNurseVisits.length > 0 && (
            <div>
              <h3 className="font-semibold text-amber-700 mb-1">
                ⚠ Needs decision — {noNurseVisits.length} visit{noNurseVisits.length !== 1 ? 's' : ''} the scheduler couldn't fit in
              </h3>
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 mb-3 text-xs text-amber-800">
                The scheduler ran out of free nurses for these visits. Each card shows exactly why. You can manually assign
                a nurse — the conflict check will show whether they can actually make it. If you've freed up nurses by
                reassigning above, some of these may now be possible.
              </div>
              <div className="space-y-4">
                {noNurseVisits.map((r, i) => (
                  <div key={`${r.visit.treatmentId}-conflict`} className="rounded-lg border-2 border-amber-300 overflow-hidden">
                    <div className="bg-amber-100 px-3 py-2 flex items-start gap-2 text-xs">
                      <span className="font-bold text-amber-700 flex-shrink-0 mt-0.5">WHY</span>
                      <span className="text-amber-900">
                        {r.conflictReason || 'No free nurse found at any valid time slot.'}
                      </span>
                    </div>
                    {r.conflictsWith.length > 0 && (
                      <div className="bg-amber-50 border-t border-amber-200 px-3 py-1.5 text-xs text-amber-700">
                        <span className="font-semibold">Blocked by:</span>{' '}
                        {r.conflictsWith.map(c => c.patientName).join(', ')}
                        {' '}— already assigned to the only eligible nurse{r.conflictsWith.length > 1 ? 's' : ''} at this time.
                      </div>
                    )}
                    <VisitCard
                      result={r}
                      rank={cleanVisits.length + brokenVisits.length + i + 1}
                      assignedNurseId={assignments.get(r.visit.treatmentId)}
                      onAssign={id => handleAssignClick(r.visit.treatmentId, id, r)}
                      isPostConflict={false}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Can't be done today ───────────────── */}
          {ineligible.length > 0 && (
            <div>
              <h3 className="font-semibold text-red-600 mb-1">
                ✕ Can't be done today — {ineligible.length} visit{ineligible.length !== 1 ? 's' : ''}
              </h3>
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 mb-3 text-xs text-red-700">
                These visits were rejected before scheduling because they violate a constraint set to <strong>Hard</strong> in your
                configuration. The specific reason is shown on each card. Either relax the constraint to Soft, or escalate manually.
              </div>
              <div className="space-y-2">
                {ineligible.map(r => (
                  <VisitCard key={`${r.visit.treatmentId}-flagged`} result={r} rank={0} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
