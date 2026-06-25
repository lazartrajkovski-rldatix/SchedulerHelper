import React from 'react';
import type { ScoredVisit, Clinician } from '../types';
import { travelSummary, travelMins } from '../lib/travel';

interface Props {
  results: ScoredVisit[];
  clinicians: Clinician[];
  /** User's manual nurse assignments: treatmentId → nurseId */
  assignments?: Map<number, number>;
}

const RAG_BADGE: Record<string, string> = {
  Red:    'bg-red-100 text-red-700',
  Yellow: 'bg-yellow-100 text-yellow-700',
  Green:  'bg-green-100 text-green-700',
};
const RAG_DOT: Record<string, string> = {
  Red:    'bg-red-500',
  Yellow: 'bg-yellow-400',
  Green:  'bg-green-500',
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

function fmt(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function endTime(slotFrom: string, durationMins: number) {
  const d = new Date(slotFrom);
  d.setMinutes(d.getMinutes() + durationMins);
  return fmt(d.toISOString());
}

export function NurseDayPlan({ results, clinicians, assignments = new Map() }: Props) {
  // Build each nurse's confirmed schedule:
  //   1. If user manually assigned a nurse (assignments map), use that
  //   2. Otherwise fall back to the simulation's suggestion (suggestedNurseId)
  // This means the day plan always reflects what the user has actually confirmed.
  const nurseVisits = new Map<number, Array<{
    patientName: string;
    slotFrom: string;
    durationMins: number;
    rag: string;
    bandId: number;
    band: string;
    postcode: string;
  }>>();

  clinicians.forEach(c => nurseVisits.set(c.id, []));

  results.forEach(sv => {
    if (!sv.isEligible || sv.suggestedSlotFrom === null) return;
    // Prefer manual assignment, fall back to simulation suggestion
    const nurseId = assignments.get(sv.visit.treatmentId) ?? sv.suggestedNurseId;
    if (nurseId === null) return;
    const list = nurseVisits.get(nurseId);
    if (!list) return;
    list.push({
      patientName: sv.visit.patientName,
      slotFrom: sv.suggestedSlotFrom,
      durationMins: sv.visit.totalTime,
      rag: sv.visit.ragStatus.name,
      bandId: sv.visit.bandId,
      band: sv.visit.band,
      postcode: sv.visit.postcode,
    });
  });

  const hasManualOverrides = assignments.size > 0;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
        Nurse day plan — who takes which patient and when
      </h3>
      <p className="text-xs text-gray-400 mb-3">
        {hasManualOverrides
          ? 'Showing your confirmed assignments (✓). Visits you haven\'t confirmed yet show the scheduler\'s suggestion. Check for red travel blocks — those mean a journey is impossible with your current choices.'
          : 'Showing the scheduler\'s recommended assignments. Click a nurse on any visit to confirm or change the assignment.'}
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {clinicians.map(nurse => {
          const visits = (nurseVisits.get(nurse.id) ?? []).sort(
            (a, b) => new Date(a.slotFrom).getTime() - new Date(b.slotFrom).getTime()
          );
          const totalMins = visits.reduce((s, v) => s + v.durationMins, 0);

          // Shift hours from availability data
          const shiftStart = nurse.availabilities[0]?.actual.startDate
            ? fmt(nurse.availabilities[0].actual.startDate) : '??:??';
          const shiftEnd = nurse.availabilities[0]?.actual.endDate
            ? fmt(nurse.availabilities[0].actual.endDate) : '??:??';
          const shiftMins = nurse.availabilities[0]
            ? (new Date(nurse.availabilities[0].actual.endDate).getTime() - new Date(nurse.availabilities[0].actual.startDate).getTime()) / 60_000
            : 0;

          return (
            <div key={nurse.id} className="border border-gray-200 rounded-lg overflow-hidden">
              {/* Nurse header */}
              <div
                className="px-3 py-2 flex items-center gap-2"
                style={{ backgroundColor: `#${nurse.clinicianColor}18` }}
              >
                <span
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: `#${nurse.clinicianColor}` }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-gray-800 truncate">{nurse.name}</div>
                  <div className="text-xs text-gray-500">{nurse.band.replace('District Nurse ', '').replace(' Staff Nurse', '')}</div>
                  {/* Shift hours — the key info the scheduler uses */}
                  <div className="text-xs font-mono mt-0.5 flex items-center gap-1">
                    <span className="text-gray-400">Shift:</span>
                    <span className="font-semibold text-gray-700">{shiftStart} – {shiftEnd}</span>
                    <span className="text-gray-400">({Math.round(shiftMins / 60)}h)</span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-sm font-bold text-gray-700">{visits.length}</div>
                  <div className="text-xs text-gray-400">visit{visits.length !== 1 ? 's' : ''}</div>
                </div>
              </div>

              {/* Visit schedule */}
              <div className="divide-y divide-gray-100">
                {visits.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-gray-400 italic text-center">
                    No visits assigned
                  </div>
                ) : (
                  visits.map((v, i) => {
                    const end = endTime(v.slotFrom, v.durationMins);
                    const bandColor = BAND_COLORS[v.bandId] ?? 'bg-gray-100 text-gray-700';

                    // Travel window to next visit
                    const nextVisit = visits[i + 1];
                    let travelBlock: React.ReactNode = null;
                    if (nextVisit) {
                      const driveMins   = travelMins(v.postcode, nextVisit.postcode);
                      const endMs       = new Date(v.slotFrom).getTime() + v.durationMins * 60_000;
                      const nextStartMs = new Date(nextVisit.slotFrom).getTime();
                      const gapMins     = Math.round((nextStartMs - endMs) / 60_000);
                      const bufferMins  = gapMins - driveMins;

                      // Colour: red = not enough time (shouldn't happen post-simulation), amber = tight (<15min buffer), green = fine
                      const bg      = bufferMins < 0  ? 'bg-red-100 border border-red-300 text-red-800'
                                    : bufferMins < 15 ? 'bg-amber-50 border border-amber-200 text-amber-800'
                                    : 'bg-gray-50 text-gray-500';
                      const icon    = bufferMins < 0  ? '🚨' : bufferMins < 15 ? '⚠️' : '🚗';
                      const verdict = bufferMins < 0  ? `NOT ENOUGH TIME — ${Math.abs(bufferMins)} min short`
                                    : bufferMins < 15 ? `Only ${bufferMins} min to spare`
                                    : `${bufferMins} min buffer`;

                      travelBlock = (
                        <div className={`mx-3 my-1 px-2 py-1.5 rounded text-xs ${bg}`}>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span>{icon}</span>
                            <span className="font-medium">{travelSummary(v.postcode, nextVisit.postcode)}</span>
                            <span className="text-gray-400 mx-1">·</span>
                            <span>Gap between visits: <strong>{gapMins} min</strong></span>
                            <span className="text-gray-400 mx-1">·</span>
                            <span className="font-semibold">{verdict}</span>
                          </div>
                          <div className="mt-0.5 text-gray-400" style={{ fontSize: '10px' }}>
                            Finishes {end} → needs to leave immediately → arrives ~{(() => {
                              const arr = new Date(endMs + driveMins * 60_000);
                              return `${String(arr.getHours()).padStart(2,'0')}:${String(arr.getMinutes()).padStart(2,'0')}`;
                            })()} · next visit starts {(() => {
                              const ns = new Date(nextStartMs);
                              return `${String(ns.getHours()).padStart(2,'0')}:${String(ns.getMinutes()).padStart(2,'0')}`;
                            })()}
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div key={i}>
                        <div className="px-3 py-2 flex items-start gap-2">
                          {/* Time column */}
                          <div className="flex-shrink-0 text-right w-20">
                            <div className="text-xs font-mono font-semibold text-gray-700">{fmt(v.slotFrom)}</div>
                            <div className="text-xs font-mono text-gray-400">{end}</div>
                            <div className="text-xs text-gray-400 mt-0.5">{v.durationMins} min</div>
                          </div>
                          {/* Divider with RAG dot */}
                          <div className="flex flex-col items-center flex-shrink-0 pt-1">
                            <div className={`w-2.5 h-2.5 rounded-full ${RAG_DOT[v.rag] ?? 'bg-gray-400'}`} />
                            {i < visits.length - 1 && <div className="w-px flex-1 bg-gray-200 mt-1" style={{ minHeight: 20 }} />}
                          </div>
                          {/* Patient info */}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-gray-800 leading-tight">{v.patientName}</div>
                            <div className="text-xs text-gray-400 mt-0.5">{v.postcode}</div>
                            <div className="flex flex-wrap gap-1 mt-1">
                              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${bandColor}`}>{v.band}</span>
                              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${RAG_BADGE[v.rag] ?? ''}`}>{v.rag}</span>
                            </div>
                          </div>
                        </div>
                        {travelBlock}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Footer: total time */}
              {visits.length > 0 && (
                <div className="px-3 py-1.5 bg-gray-50 border-t border-gray-100 text-xs text-gray-400 text-right">
                  {totalMins} min total · {Math.round((totalMins / 960) * 100)}% of shift
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-gray-400 mt-3">
        Based on the simulation's band-efficient matching. Times show when each visit is scheduled to start and finish.
      </p>
    </div>
  );
}
