import type { Visit, Clinician, ClinicConfig, ScoredVisit } from '../types';
import { travelMins } from './travel';

function isWithinShift(
  timeSlots: Visit['timeSlots'],
  availability: Clinician['availabilities'][0]
): boolean {
  const shiftStart = new Date(availability.actual.startDate).getTime();
  const shiftEnd = new Date(availability.actual.endDate).getTime();
  return timeSlots.some(slot => {
    const slotStart = new Date(slot.from).getTime();
    return slotStart >= shiftStart && slotStart < shiftEnd;
  });
}

export function processVisits(
  visits: Visit[],
  clinicians: Clinician[],
  config: ClinicConfig
): ScoredVisit[] {
  const c = config.constraints;

  const scored: ScoredVisit[] = visits.map(visit => {
    const result: ScoredVisit = {
      visit,
      isEligible: true,
      inBatch: false,
      ineligibilityReasons: [],
      totalScore: 0,
      scoreBreakdown: {
        urgency: 0, bandEfficiency: 0, bandMatch: 0,
        timeFlexibility: 0, patientContinuity: 0,
        workloadBalance: 0, mileageCap: 0,
        nurseAvailability: 0, timeWindow: 0,
      },
      eligibleClinicians: [],
      suggestedNurseId: null,
      suggestedSlotFrom: null,
      conflictsWith: [],
      conflictReason: '',
    };
    let eligible = [...clinicians];

    // ── Hard gates ──────────────────────────────────────────────
    if (c.bandMatch.mode === 'hard') {
      eligible = eligible.filter(n => n.gradeEquivalence >= visit.bandId);
      if (eligible.length === 0) {
        result.isEligible = false;
        result.ineligibilityReasons.push(`No nurse meets Band ${visit.bandId} requirement`);
        return result;
      }
    }

    if (c.timeWindow.mode === 'hard') {
      eligible = eligible.filter(n =>
        n.availabilities.some(a => isWithinShift(visit.timeSlots, a))
      );
      if (eligible.length === 0) {
        result.isEligible = false;
        result.ineligibilityReasons.push("No time slot falls within any nurse's shift hours");
        return result;
      }
    }

    if (c.nurseAvailability.mode === 'hard') {
      eligible = eligible.filter(n => n.assignedVisitsCount < 8);
      if (eligible.length === 0) {
        result.isEligible = false;
        result.ineligibilityReasons.push('All qualified nurses are at capacity');
        return result;
      }
    }

    if (c.mileageCap.mode === 'hard') {
      eligible = eligible.filter(n => {
        if (!n.hasMileageCap || !n.hasValidBasePostCode) return true;
        return visit.simulatedDistanceMiles <= n.mileageCap;
      });
      if (eligible.length === 0) {
        result.isEligible = false;
        result.ineligibilityReasons.push("Visit exceeds all eligible nurses' mileage caps");
        return result;
      }
    }

    if (c.patientContinuity.mode === 'hard' && visit.preferredClinicianId !== null) {
      const found = eligible.find(n => n.id === visit.preferredClinicianId);
      if (!found) {
        result.isEligible = false;
        result.ineligibilityReasons.push(`Required clinician (ID: ${visit.preferredClinicianId}) not available`);
        return result;
      }
    }

    result.eligibleClinicians = eligible;

    // ── Soft scoring ─────────────────────────────────────────────
    const bd = result.scoreBreakdown;

    if (c.urgency.mode === 'soft') {
      bd.urgency = visit.ragStatus.name === 'Red' ? 100 : visit.ragStatus.name === 'Yellow' ? 60 : 30;
    }

    if ((c.bandMatch.mode === 'soft' || c.bandEfficiency.mode === 'soft') && eligible.length > 0) {
      const minGap = Math.min(...eligible.map(n => n.gradeEquivalence - visit.bandId));
      const score = Math.max(0, 100 - minGap * 20);
      if (c.bandMatch.mode === 'soft') bd.bandMatch = score;
      if (c.bandEfficiency.mode === 'soft') bd.bandEfficiency = score;
    }

    if (c.timeFlexibility.mode === 'soft') {
      const n = visit.timeSlots.length;
      bd.timeFlexibility =
        visit.treatmentTimeType === 'SpecificTime' ? 100 :
        n === 1 ? 90 : n <= 3 ? 70 : n <= 6 ? 50 : 20;
    }

    if (c.patientContinuity.mode === 'soft' && visit.preferredClinicianId !== null) {
      bd.patientContinuity = eligible.some(n => n.id === visit.preferredClinicianId) ? 100 : 0;
    }

    if (c.workloadBalance.mode === 'soft' && eligible.length > 0) {
      const minAssigned = Math.min(...eligible.map(n => n.assignedVisitsCount));
      bd.workloadBalance = Math.max(0, 100 - minAssigned * 15);
    }

    if (c.mileageCap.mode === 'soft' && eligible.length > 0) {
      const reachable = eligible.filter(n => !n.hasValidBasePostCode || visit.simulatedDistanceMiles <= n.mileageCap);
      bd.mileageCap = reachable.length > 0 ? Math.round((reachable.length / eligible.length) * 100) : 0;
    }

    if (c.nurseAvailability.mode === 'soft' && eligible.length > 0) {
      const minAssigned = Math.min(...eligible.map(n => n.assignedVisitsCount));
      bd.nurseAvailability = Math.max(0, 100 - minAssigned * 15);
    }

    // ── Weighted total (normalised) ───────────────────────────────
    let totalWeight = 0;
    let weightedSum = 0;
    for (const [key, setting] of Object.entries(c)) {
      if (setting.mode === 'soft' && setting.weight > 0) {
        const score = bd[key as keyof typeof bd];
        totalWeight += setting.weight;
        weightedSum += setting.weight * score;
      }
    }
    result.totalScore = totalWeight === 0 ? 0 : Math.round(weightedSum / totalWeight);

    return result;
  });

  // All eligible visits are included — the tool tells you what can/can't be done,
  // no manual batch size needed.
  const eligible = scored.filter(s => s.isEligible).sort((a, b) => b.totalScore - a.totalScore);
  eligible.forEach(s => { s.inBatch = true; });

  // ── Scheduling simulation ─────────────────────────────────────────
  // Rules:
  //   1. SpecificTime visits are anchors — placed first at their fixed time.
  //   2. Flexible (Multiple) visits fill the gaps, using the ACTUAL earliest
  //      the nurse can arrive (travel from prev + 15-min buffer), rounded to
  //      the nearest 5 min.  No more 3-minute gaps.
  //   3. Both travel-TO and travel-FROM are validated for every placement.
  //      A nurse is rejected if they can arrive in time but can't then reach
  //      their next committed visit.

  type Block = { treatmentId: number; from: number; until: number; postcode: string };

  const nurseTimeline = new Map<number, Block[]>();

  /** 15-minute arrival buffer on top of raw drive time (parking, walking, handover). */
  const BUFFER_MS = 15 * 60_000;

  const getBlocks = (nurseId: number): Block[] => nurseTimeline.get(nurseId) ?? [];

  /** Chronologically last block that ends AT OR BEFORE `beforeMs`. */
  const prevOf = (nurseId: number, beforeMs: number): Block | null =>
    getBlocks(nurseId)
      .filter(b => b.until <= beforeMs)
      .sort((a, b) => b.until - a.until)[0] ?? null;

  /** Chronologically first block that starts AT OR AFTER `afterMs`. */
  const nextOf = (nurseId: number, afterMs: number): Block | null =>
    getBlocks(nurseId)
      .filter(b => b.from >= afterMs)
      .sort((a, b) => a.from - b.from)[0] ?? null;

  /** Does the nurse have any block that overlaps [fromMs, untilMs)? */
  const hasOverlap = (nurseId: number, fromMs: number, untilMs: number): boolean =>
    getBlocks(nurseId).some(b => fromMs < b.until && untilMs > b.from);

  /** HH:MM string from epoch ms. */
  const fmt = (ms: number): string => {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  /**
   * For a FLEXIBLE visit: find the earliest time in [windowStartMs, windowEndMs]
   * that this nurse can start a visit at targetPostcode (lasting durationMs).
   *
   * Strategy: generate candidate start times from each existing block's end
   * (with travel + buffer), then validate both the travel-TO and travel-FROM
   * constraints.  Returns null if no valid window exists.
   *
   * Also clamps to the nurse's actual shift hours so a nurse working 08:00–16:00
   * is never scheduled at 19:00.
   */
  const optimalFlexStart = (
    nurseId: number,
    targetPostcode: string,
    durationMs: number,
    windowStartMs: number,
    windowEndMs: number,
  ): number | null => {
    // ── Clamp to shift hours ─────────────────────────────────────
    const nurse = clinicians.find(n => n.id === nurseId);
    const shiftStart = nurse?.availabilities[0]?.actual.startDate
      ? new Date(nurse.availabilities[0].actual.startDate).getTime() : 0;
    const shiftEnd = nurse?.availabilities[0]?.actual.endDate
      ? new Date(nurse.availabilities[0].actual.endDate).getTime() : Infinity;

    const effWindowStart = Math.max(windowStartMs, shiftStart);
    // Latest start = min(windowEnd, shiftEnd - duration) so visit finishes within shift
    const effWindowEnd = Math.min(windowEndMs, shiftEnd - durationMs);
    if (effWindowStart > effWindowEnd) return null; // shift doesn't overlap the visit window

    // Build candidate start points: window start + right after each existing block
    const rawCandidates: number[] = [effWindowStart];
    for (const b of getBlocks(nurseId)) {
      const trav = travelMins(b.postcode, targetPostcode) * 60_000;
      rawCandidates.push(b.until + trav + BUFFER_MS);
    }
    rawCandidates.sort((a, b) => a - b);

    for (const raw of rawCandidates) {
      // Round up to nearest 5 min and clamp to effective window
      const start = Math.max(
        Math.ceil(raw / (5 * 60_000)) * (5 * 60_000),
        effWindowStart,
      );
      if (start > effWindowEnd) continue;
      const end = start + durationMs;

      // 1. No overlap with any committed block
      if (hasOverlap(nurseId, start, end)) continue;

      // 2. Can the nurse arrive from their previous block in time?
      const prev = prevOf(nurseId, start);
      if (prev) {
        const trav = travelMins(prev.postcode, targetPostcode) * 60_000;
        if (prev.until + trav + BUFFER_MS > start) continue;
      }

      // 3. After this visit, can the nurse reach their next block?
      const next = nextOf(nurseId, end);
      if (next) {
        const trav = travelMins(targetPostcode, next.postcode) * 60_000;
        if (end + trav + BUFFER_MS > next.from) continue;
      }

      return start; // ✓ valid slot found
    }
    return null;
  };

  /**
   * For a SPECIFIC-TIME visit: can nurse arrive at targetPostcode by slotStartMs?
   * Uses the chronologically-previous block (not just the last-placed block)
   * so that Robert Green at 16:00 does NOT incorrectly block a 15:00 check.
   */
  const canArriveBy = (nurseId: number, targetPostcode: string, slotStartMs: number): boolean => {
    const prev = prevOf(nurseId, slotStartMs);
    if (!prev) return true;
    const trav = travelMins(prev.postcode, targetPostcode) * 60_000;
    return prev.until + trav + BUFFER_MS <= slotStartMs;
  };

  /** After finishing a visit at targetPostcode at slotEndMs, can the nurse reach their next block? */
  const canLeaveAfter = (nurseId: number, targetPostcode: string, slotEndMs: number): boolean => {
    const next = nextOf(nurseId, slotEndMs);
    if (!next) return true;
    const trav = travelMins(targetPostcode, next.postcode) * 60_000;
    return slotEndMs + trav + BUFFER_MS <= next.from;
  };

  /** Commit a nurse to a block and update their timeline. */
  const commitBlock = (nurseId: number, block: Block) => {
    if (!nurseTimeline.has(nurseId)) nurseTimeline.set(nurseId, []);
    nurseTimeline.get(nurseId)!.push(block);
  };

  // SpecificTime visits are anchors — process them before flexible ones.
  // Within same time: fewest eligible nurses first (most constrained placed first).
  // This prevents an easy visit from "stealing" the only nurse a hard visit can use.
  const simOrder = [...eligible].sort((a, b) => {
    const af = a.visit.treatmentTimeType === 'SpecificTime' ? 0 : 1;
    const bf = b.visit.treatmentTimeType === 'SpecificTime' ? 0 : 1;
    if (af !== bf) return af - bf;
    const ae = a.visit.timeSlots.length > 0 ? new Date(a.visit.timeSlots[0].from).getTime() : Infinity;
    const be = b.visit.timeSlots.length > 0 ? new Date(b.visit.timeSlots[0].from).getTime() : Infinity;
    if (ae !== be) return ae - be;
    // Most constrained first: fewest nurse options → placed before visits with many options
    if (a.eligibleClinicians.length !== b.eligibleClinicians.length)
      return a.eligibleClinicians.length - b.eligibleClinicians.length;
    // Final tiebreak: more nurses needed (harder to staff)
    return b.visit.numberOfClinicians - a.visit.numberOfClinicians;
  });

  for (const sv of simOrder) {
    const durationMs = sv.visit.totalTime * 60 * 1000;
    const needed     = sv.visit.numberOfClinicians;
    const isFlexible = sv.visit.treatmentTimeType !== 'SpecificTime' && sv.visit.timeSlots.length > 0;
    let placed = false;

    if (isFlexible) {
      // ── Flexible visit: compute actual optimal start per nurse ──────────────
      // Instead of snapping to hourly slot boundaries, ask "what's the earliest
      // minute this nurse can realistically arrive (travel + 15-min buffer),
      // given their existing schedule?"  This prevents 3-minute gaps.
      const windowStartMs = new Date(sv.visit.timeSlots[0].from).getTime();
      const windowEndMs   = new Date(sv.visit.timeSlots[sv.visit.timeSlots.length - 1].from).getTime();

      const candidates = sv.eligibleClinicians
        .map(n => {
          const start = optimalFlexStart(n.id, sv.visit.postcode, durationMs, windowStartMs, windowEndMs);
          return start !== null ? { nurse: n, start } : null;
        })
        .filter(Boolean) as Array<{ nurse: typeof sv.eligibleClinicians[0]; start: number }>;

      if (candidates.length >= needed) {
        // Prefer lowest band (most efficient match), then earliest start
        candidates.sort((a, b) =>
          a.nurse.gradeEquivalence !== b.nurse.gradeEquivalence
            ? a.nurse.gradeEquivalence - b.nurse.gradeEquivalence
            : a.start - b.start
        );

        const assigned = candidates.slice(0, needed);
        const chosenStart = assigned[0].start;

        sv.suggestedNurseId  = assigned[0].nurse.id;
        sv.suggestedSlotFrom = new Date(chosenStart).toISOString();

        assigned.forEach(({ nurse, start }) => {
          commitBlock(nurse.id, {
            treatmentId: sv.visit.treatmentId,
            from:        start,
            until:       start + durationMs,
            postcode:    sv.visit.postcode,
          });
        });
        placed = true;
      }

    } else {
      // ── Specific-time visit: check each fixed slot ──────────────────────────
      // Both canArriveBy AND canLeaveAfter must pass.
      for (const slot of sv.visit.timeSlots) {
        const startMs  = new Date(slot.from).getTime();
        const finishMs = startMs + durationMs;

        const free = sv.eligibleClinicians
          .filter(n => {
            // Must end before nurse's shift ends
            const shiftEnd = n.availabilities[0]?.actual.endDate
              ? new Date(n.availabilities[0].actual.endDate).getTime() : Infinity;
            if (finishMs > shiftEnd) return false;
            return (
              !hasOverlap(n.id, startMs, finishMs) &&
              canArriveBy(n.id, sv.visit.postcode, startMs) &&
              canLeaveAfter(n.id, sv.visit.postcode, finishMs)
            );
          })
          .sort((a, b) => a.gradeEquivalence - b.gradeEquivalence);

        if (free.length >= needed) {
          sv.suggestedNurseId  = free[0].id;
          sv.suggestedSlotFrom = slot.from;
          free.slice(0, needed).forEach(n => {
            commitBlock(n.id, {
              treatmentId: sv.visit.treatmentId,
              from:        startMs,
              until:       finishMs,
              postcode:    sv.visit.postcode,
            });
          });
          placed = true;
          break;
        }
      }
    }

    if (!placed) {
      // ── WHY couldn't this visit be placed? ──────────────────────────────────
      // Generate a specific human-readable reason per nurse covering:
      //   • Time overlap (nurse mid-visit)
      //   • Can't arrive (travel-TO too long)
      //   • Can't leave (travel-FROM to next block too long — e.g. Dell → Nina → Robert Green)
      const reasonParts = new Set<string>();

      for (const nurse of sv.eligibleClinicians) {
        if (isFlexible) {
          // For flexible visits: explain why no slot in the window works
          const windowStartMs = new Date(sv.visit.timeSlots[0].from).getTime();
          const windowEndMs   = new Date(sv.visit.timeSlots[sv.visit.timeSlots.length - 1].from).getTime();

          // Try each candidate start to find the first failure reason
          const rawCandidates = [windowStartMs, ...getBlocks(nurse.id).map(b => {
            const trav = travelMins(b.postcode, sv.visit.postcode) * 60_000;
            return b.until + trav + BUFFER_MS;
          })].sort((a, b) => a - b);

          let explained = false;
          for (const raw of rawCandidates) {
            const start = Math.max(Math.ceil(raw / (5 * 60_000)) * (5 * 60_000), windowStartMs);
            if (start > windowEndMs) {
              if (!explained) {
                reasonParts.add(`${nurse.name}: earliest available (${fmt(start)}) is outside the visit window`);
                explained = true;
              }
              break;
            }
            const end = start + durationMs;

            if (hasOverlap(nurse.id, start, end)) continue;

            const prev = prevOf(nurse.id, start);
            if (prev) {
              const trav = travelMins(prev.postcode, sv.visit.postcode) * 60_000;
              if (prev.until + trav + BUFFER_MS > start) continue;
            }

            const next = nextOf(nurse.id, end);
            if (next) {
              const trav = travelMins(sv.visit.postcode, next.postcode) * 60_000;
              if (end + trav + BUFFER_MS > next.from) {
                const busyVisit = eligible.find(s => s.visit.treatmentId === next.treatmentId);
                const arrivalMs = end + trav;
                reasonParts.add(
                  `${nurse.name} could start at ${fmt(start)} but after the visit (ends ${fmt(end)}) ` +
                  `needs ~${Math.round(trav / 60_000)}min to reach ${busyVisit?.visit.patientName ?? 'next patient'} ` +
                  `(starts ${fmt(next.from)}) — would arrive ${fmt(arrivalMs)}`
                );
                explained = true;
                break;
              }
            }
          }
        } else {
          // For specific-time visits: explain per slot
          for (const slot of sv.visit.timeSlots) {
            const startMs  = new Date(slot.from).getTime();
            const finishMs = startMs + durationMs;

            if (hasOverlap(nurse.id, startMs, finishMs)) {
              const overlap = getBlocks(nurse.id).find(b => startMs < b.until && finishMs > b.from);
              if (overlap) {
                const busyVisit = eligible.find(s => s.visit.treatmentId === overlap.treatmentId);
                reasonParts.add(
                  `${nurse.name} is with ${busyVisit?.visit.patientName ?? 'another patient'} until ${fmt(overlap.until)}`
                );
              }
            } else if (!canArriveBy(nurse.id, sv.visit.postcode, startMs)) {
              const prev = prevOf(nurse.id, startMs);
              if (prev) {
                const trav = travelMins(prev.postcode, sv.visit.postcode) * 60_000;
                const arrival = prev.until + trav;
                const busyVisit = eligible.find(s => s.visit.treatmentId === prev.treatmentId);
                reasonParts.add(
                  `${nurse.name} needs ~${Math.round(trav / 60_000)}min travel from ` +
                  `${busyVisit?.visit.patientName ?? prev.postcode} (finishes ${fmt(prev.until)}) ` +
                  `— arrives ${fmt(arrival)}, slot starts ${fmt(startMs)}`
                );
              }
            } else if (!canLeaveAfter(nurse.id, sv.visit.postcode, finishMs)) {
              const next = nextOf(nurse.id, finishMs);
              if (next) {
                const trav = travelMins(sv.visit.postcode, next.postcode) * 60_000;
                const arrival = finishMs + trav;
                const busyVisit = eligible.find(s => s.visit.treatmentId === next.treatmentId);
                reasonParts.add(
                  `${nurse.name} could arrive in time but would finish at ${fmt(finishMs)} — ` +
                  `~${Math.round(trav / 60_000)}min to reach ${busyVisit?.visit.patientName ?? 'next patient'} ` +
                  `(starts ${fmt(next.from)}), arriving ${fmt(arrival)}`
                );
              }
            }
          }
        }
      }

      sv.conflictReason = [...reasonParts].slice(0, 2).join(' · ');

      // One-directional: only the unplaced visit records which visits blocked it.
      const blockingIds = new Set<number>();
      for (const slot of sv.visit.timeSlots) {
        const startMs  = new Date(slot.from).getTime();
        const finishMs = startMs + durationMs;
        for (const nurse of sv.eligibleClinicians) {
          const overlap = getBlocks(nurse.id).find(b => startMs < b.until && finishMs > b.from);
          if (overlap) blockingIds.add(overlap.treatmentId);
        }
      }
      sv.conflictsWith = [...blockingIds].map(id => ({
        treatmentId: id,
        patientName: eligible.find(s => s.visit.treatmentId === id)?.visit.patientName ?? `Visit ${id}`,
      }));
    }
  }

  return [...eligible, ...scored.filter(s => !s.isEligible)];
}

