/**
 * Real-time assignment feasibility checker.
 *
 * When a user clicks a nurse pill to assign a nurse to a visit, this module
 * computes whether that assignment is actually feasible given:
 *   1. The nurse's already-confirmed visits (from the assignments map)
 *   2. The nurse's simulation-suggested visits (for unmodified visits)
 *   3. Travel time between consecutive visits using postcodes
 *
 * The result is shown in the AssignWarningModal before the user confirms.
 */

import type { ScoredVisit } from '../types';
import { travelMins } from './travel';

export type ConflictType = 'time_overlap' | 'travel_to' | 'travel_from' | 'busy_in_window' | 'no_gap';

export interface AssignConflict {
  type: ConflictType;
  patientName: string;
  detail: string;
  /** Supporting detail lines rendered as bullet points under the headline */
  bullets?: string[];
}

export interface AssignmentCheck {
  /** True if at least one time slot exists where the nurse can do this visit */
  feasible: boolean;
  /** Specific conflicts found (capped at 3 for display) */
  conflicts: AssignConflict[];
  /** This nurse's full effective schedule today (for context in the modal) */
  nurseSchedule: Array<{ patientName: string; timeRange: string; postcode: string }>;
  /**
   * Visits where this nurse is the ONLY eligible option.
   * Reassigning them to the target visit would leave these stranded with no nurse.
   */
  wouldStrand: Array<{ patientName: string; treatmentId: number }>;
}

function fmt(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function checkAssignment(
  nurseId: number,
  targetSv: ScoredVisit,
  assignments: Map<number, number>,
  results: ScoredVisit[],
): AssignmentCheck {

  // ── Build this nurse's effective schedule ─────────────────────────────────
  // For each eligible visit:
  //   • If user has manually assigned a nurse → use that (use first slot as timing)
  //   • Else fall back to simulation's suggestedNurseId + suggestedSlotFrom
  const schedule = results
    .filter(r => {
      if (r.visit.treatmentId === targetSv.visit.treatmentId) return false;
      if (!r.isEligible) return false;
      const effectiveNurse = assignments.get(r.visit.treatmentId) ?? r.suggestedNurseId;
      return effectiveNurse === nurseId;
    })
    .map(r => {
      const manualAssignment = assignments.has(r.visit.treatmentId);
      const slotFrom = manualAssignment
        ? (r.suggestedSlotFrom ?? r.visit.timeSlots[0]?.from)  // use sim slot even for manual
        : (r.suggestedSlotFrom ?? r.visit.timeSlots[0]?.from);
      if (!slotFrom) return null;
      const from  = new Date(slotFrom).getTime();
      const until = from + r.visit.totalTime * 60_000;
      return {
        treatmentId: r.visit.treatmentId,
        patientName: r.visit.patientName,
        from,
        until,
        postcode: r.visit.postcode,
        timeRange: `${fmt(from)}–${fmt(until)}`,
      };
    })
    .filter(Boolean) as Array<{
      treatmentId: number;
      patientName: string;
      from: number;
      until: number;
      postcode: string;
      timeRange: string;
    }>;

  schedule.sort((a, b) => a.from - b.from);

  const nurseSchedule = schedule.map(s => ({
    patientName: s.patientName,
    timeRange: s.timeRange,
    postcode: s.postcode,
  }));

  // ── Try each time slot of the target visit ────────────────────────────────
  // For flexible visits (TimeSlots / MultipleVisitsPerDay), slot times are
  // just candidate windows — the visit is not fixed to any one time.
  // We must NOT show "slot 15:00 overlaps" as if the visit is required at 15:00.
  const isFlexible = targetSv.visit.treatmentTimeType !== 'SpecificTime'
    && targetSv.visit.timeSlots.length > 2;

  const seen = new Set<string>();
  const conflicts: AssignConflict[] = [];
  let feasible = false;

  for (const slot of targetSv.visit.timeSlots) {
    const slotStart = new Date(slot.from).getTime();
    const slotEnd   = slotStart + targetSv.visit.totalTime * 60_000;

    // 1. Time overlap with an already-committed visit?
    const overlapping = schedule.filter(b => slotStart < b.until && slotEnd > b.from);
    if (overlapping.length > 0) {
      overlapping.forEach(b => {
        const key = `overlap-${b.patientName}`;
        if (!seen.has(key)) {
          seen.add(key);
          if (isFlexible) {
            // For flexible visits: the nurse is simply BUSY during part of the window.
            // Do NOT say "slot X:XX overlaps" — the visit isn't fixed at that time.
            conflicts.push({
              type: 'busy_in_window',
              patientName: b.patientName,
              detail: `Busy with ${b.patientName} (${b.timeRange}) during part of the available window — reduces possible start times`,
            });
          } else {
            conflicts.push({
              type: 'time_overlap',
              patientName: b.patientName,
              detail: `Already doing ${b.patientName} (${b.timeRange}) — this visit is fixed at ${fmt(slotStart)}`,
            });
          }
        }
      });
      continue;
    }

    // 2. Can the nurse travel FROM their previous visit in time?
    const before = schedule.filter(b => b.until <= slotStart).at(-1);
    if (before) {
      const mins       = travelMins(before.postcode, targetSv.visit.postcode);
      const arrivalMs  = before.until + mins * 60_000;
      if (arrivalMs > slotStart) {
        const key = `travel_to-${before.patientName}`;
        if (!seen.has(key)) {
          seen.add(key);
          if (isFlexible) {
            conflicts.push({
              type: 'travel_to',
              patientName: before.patientName,
              detail: `Finishes ${before.patientName} at ${fmt(before.until)} (${before.postcode}) then ~${mins} min drive → earliest arrival ${fmt(arrivalMs)}`,
            });
          } else {
            conflicts.push({
              type: 'travel_to',
              patientName: before.patientName,
              detail: `Finishes ${before.patientName} at ${fmt(before.until)} in ${before.postcode} — ~${mins} min drive — arrives ${fmt(arrivalMs)}, but this visit is fixed at ${fmt(slotStart)}`,
            });
          }
        }
        continue;
      }
    }

    // 3. Can the nurse travel TO their next visit after this one?
    const after = schedule.filter(b => b.from >= slotEnd).at(0);
    if (after) {
      const mins      = travelMins(targetSv.visit.postcode, after.postcode);
      const leaveBy   = after.from - mins * 60_000;
      if (slotEnd > leaveBy) {
        const key = `travel_from-${after.patientName}`;
        if (!seen.has(key)) {
          seen.add(key);
          if (isFlexible) {
            conflicts.push({
              type: 'travel_from',
              patientName: after.patientName,
              detail: `After this visit, needs ~${mins} min to reach ${after.patientName} (${after.postcode}, fixed at ${fmt(after.from)}) — that leaves no time for both this visit AND the journey`,
            });
          } else {
            conflicts.push({
              type: 'travel_from',
              patientName: after.patientName,
              detail: `After this visit (ends ${fmt(slotEnd)}) needs ~${mins} min to reach ${after.patientName} (starts ${fmt(after.from)}) — would arrive ${fmt(slotEnd + mins * 60_000)}`,
            });
          }
        }
        continue;
      }
    }

    // All checks passed for this slot → feasible
    feasible = true;
    break;
  }

  // ── For flexible visits: consolidate per-slot noise into one clear summary ─
  // Instead of showing "slot 15:00 overlaps · slot 12:00 travel_to · slot 16:00 travel_from",
  // produce ONE card with a headline + bullet points explaining the actual bottleneck.
  if (isFlexible && !feasible && conflicts.length > 0) {
    const travelTo   = conflicts.filter(c => c.type === 'travel_to');
    const travelFrom = conflicts.filter(c => c.type === 'travel_from');
    const busyIn     = conflicts.filter(c => c.type === 'busy_in_window');
    const durationMins = targetSv.visit.totalTime;

    // Build bullet points in chronological order: arrive → busy → depart
    const bullets: string[] = [
      ...travelTo.map(c => c.detail),
      ...busyIn.map(c => c.detail),
      ...travelFrom.map(c => c.detail),
    ];

    // Pick the most accurate one-line headline
    let headline: string;
    if (travelTo.length > 0 && travelFrom.length > 0) {
      headline = `No ${durationMins}-min gap — too far from surrounding commitments on both sides`;
    } else if (travelTo.length > 0 && busyIn.length > 0) {
      headline = `No ${durationMins}-min gap — arrives late AND schedule blocked during the window`;
    } else if (travelFrom.length > 0 && busyIn.length > 0) {
      headline = `No ${durationMins}-min gap — schedule blocked AND can't reach next visit in time`;
    } else if (travelTo.length > 0) {
      headline = `Arrives too late — previous visit is too far away to fit a ${durationMins}-min visit`;
    } else if (travelFrom.length > 0) {
      headline = `Can't leave in time — next fixed visit is too far from here`;
    } else {
      headline = `Schedule is fully blocked during the available window`;
    }

    conflicts.length = 0;
    conflicts.push({ type: 'no_gap', patientName: '', detail: headline, bullets });
  }

  // ── Visits that ONLY this nurse can do AND that the target visit would block ─
  // Only flag if:
  //   1. This nurse is currently the only eligible nurse for that visit, AND
  //   2. At least one slot of the TARGET visit overlaps in time with that other visit
  //      (i.e. the nurse physically cannot be in both places at the same time)
  const wouldStrand: AssignmentCheck['wouldStrand'] = [];
  for (const r of results) {
    if (r.visit.treatmentId === targetSv.visit.treatmentId) continue;
    const effectiveNurse = assignments.get(r.visit.treatmentId) ?? r.suggestedNurseId;
    if (effectiveNurse !== nurseId) continue;

    // Determine timing of the other visit
    const otherSlotFrom = r.suggestedSlotFrom ?? r.visit.timeSlots[0]?.from;
    if (!otherSlotFrom) continue;
    const otherFrom  = new Date(otherSlotFrom).getTime();
    const otherUntil = otherFrom + r.visit.totalTime * 60_000;

    // Does ANY slot of the target visit overlap with the other visit's committed time?
    const hasTimeConflict = targetSv.visit.timeSlots.some(slot => {
      const s = new Date(slot.from).getTime();
      const e = s + targetSv.visit.totalTime * 60_000;
      return s < otherUntil && e > otherFrom;
    });

    // Only a stranding risk when the visits actually collide in time
    if (!hasTimeConflict) continue;

    // Are there alternatives for the other visit?
    const alternatives = r.eligibleClinicians.filter(c => c.id !== nurseId);
    if (alternatives.length === 0) {
      wouldStrand.push({ patientName: r.visit.patientName, treatmentId: r.visit.treatmentId });
    }
  }

  return {
    feasible,
    conflicts: conflicts.slice(0, 4),
    nurseSchedule,
    wouldStrand,
  };
}
