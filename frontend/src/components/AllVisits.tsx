import type { Visit } from '../types';

interface Props {
  visits: Visit[];
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

export function AllVisits({ visits }: Props) {
  const byRag = {
    Red:    visits.filter(v => v.ragStatus.name === 'Red'),
    Yellow: visits.filter(v => v.ragStatus.name === 'Yellow'),
    Green:  visits.filter(v => v.ragStatus.name === 'Green'),
  };

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
          <div className="text-2xl font-bold text-gray-700">{visits.length}</div>
          <div className="text-xs text-gray-400 mt-0.5">Total visits</div>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <div className="text-2xl font-bold text-red-600">{byRag.Red.length}</div>
          <div className="text-xs text-red-400 mt-0.5">Red (urgent)</div>
        </div>
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
          <div className="text-2xl font-bold text-yellow-600">{byRag.Yellow.length}</div>
          <div className="text-xs text-yellow-500 mt-0.5">Yellow</div>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-lg p-3">
          <div className="text-2xl font-bold text-green-600">{byRag.Green.length}</div>
          <div className="text-xs text-green-500 mt-0.5">Green (routine)</div>
        </div>
      </div>

      <p className="text-xs text-gray-400">
        All {visits.length} unassigned visits — no filtering applied. Switch to <strong>Batch Planner</strong> to see the filtered &amp; ranked result.
      </p>

      {/* Full visit list */}
      <div className="space-y-2">
        {visits.map((visit, i) => {
          const rag = RAG_STYLES[visit.ragStatus.name];
          const bandColor = BAND_COLORS[visit.bandId] ?? 'bg-gray-100 text-gray-700';
          return (
            <div
              key={`${visit.treatmentId}-${i}`}
              className={`border-l-4 ${rag.border} ${rag.bg} border border-gray-200 rounded-lg p-3`}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-gray-400 font-mono w-5">#{i + 1}</span>
                <span className="font-semibold text-sm text-gray-800">{visit.patientName}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${bandColor}`}>{visit.band}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${rag.badge}`}>{visit.ragStatus.name}</span>
                {visit.numberOfClinicians > 1 && (
                  <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">
                    ×{visit.numberOfClinicians} nurses
                  </span>
                )}
                <span className="ml-auto flex gap-3 text-xs text-gray-500">
                  <span>⏱ {visit.totalTime} min</span>
                  <span>📍 {visit.postcode}</span>
                  <span>🕐 {visit.label}</span>
                </span>
              </div>
              <div className="mt-1 text-xs text-gray-400 pl-7">
                {visit.activities.map(a => a.name).join(', ')}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
