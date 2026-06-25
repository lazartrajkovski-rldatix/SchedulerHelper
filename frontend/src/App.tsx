import { useMemo, useState } from 'react';
import type { ClinicConfig } from './types';
import { mockClinicians } from './data/mockClinicians';
import { mockVisits } from './data/mockVisits';
import { processVisits } from './lib/scheduler';
import { ConfigPage } from './components/ConfigPage';
import { BatchResults } from './components/BatchResults';
import { AllVisits } from './components/AllVisits';

const defaultConfig: ClinicConfig = {
  constraints: {
    bandMatch:         { mode: 'hard', weight: 0  },
    timeWindow:        { mode: 'hard', weight: 0  },
    nurseAvailability: { mode: 'off',  weight: 0  },
    mileageCap:        { mode: 'off',  weight: 0  },
    patientContinuity: { mode: 'off',  weight: 20 },
    urgency:           { mode: 'soft', weight: 40 },
    bandEfficiency:    { mode: 'soft', weight: 30 },
    timeFlexibility:   { mode: 'soft', weight: 20 },
    workloadBalance:   { mode: 'off',  weight: 10 },
  },
};

type Tab = 'all' | 'planner' | 'config';
type ViewMode = 'daily' | 'weekly';

function App() {
  const [config, setConfig] = useState<ClinicConfig>(defaultConfig);
  const [tab, setTab] = useState<Tab>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('daily');

  const results = useMemo(
    () => processVisits(mockVisits, mockClinicians, config),
    [config]
  );

  const hardCount = Object.values(config.constraints).filter(c => c.mode === 'hard').length;
  const softCount = Object.values(config.constraints).filter(c => c.mode === 'soft').length;

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white border-b border-gray-200 px-6 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-base font-bold text-gray-900">Scheduler Helper</h1>
            <p className="text-xs text-gray-400">
              17 Jun 2026 · {mockClinicians.length} nurses · {mockVisits.length} unassigned visits
            </p>
          </div>
          {/* Tabs */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {([
              { key: 'all',     label: `All Visits (${mockVisits.length})` },
              { key: 'planner', label: 'Batch Planner' },
              { key: 'config',  label: 'Configuration' },
            ] as { key: Tab; label: string }[]).map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-4 py-2 text-sm font-medium transition-colors border-r border-gray-200 last:border-r-0 ${
                  tab === t.key
                    ? 'bg-gray-900 text-white'
                    : 'bg-white text-gray-500 hover:bg-gray-50'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto p-5">
        {tab === 'config' ? (
          <ConfigPage config={config} onChange={setConfig} />
        ) : tab === 'all' ? (
          <>
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 mb-4 text-xs text-blue-700">
              This is the <strong>raw unfiltered pool</strong> — all {mockVisits.length} visits waiting to be assigned. Switch to <strong>Batch Planner</strong> to see how constraints filter and rank these down to your batch.
            </div>
            <AllVisits visits={mockVisits} />
          </>
        ) : (
          <>
            {/* Active config + view mode bar */}
            <div className="bg-white border border-gray-200 rounded-lg px-4 py-2 mb-4 flex items-center gap-3 flex-wrap text-xs">
              <span className="text-gray-400 font-medium">Active config:</span>
              <span className="bg-red-50 text-red-600 px-2 py-0.5 rounded font-medium">{hardCount} Hard</span>
              <span className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded font-medium">{softCount} Soft</span>

              {/* Daily / Weekly toggle */}
              <div className="flex rounded border border-gray-200 overflow-hidden ml-2">
                {(['daily', 'weekly'] as ViewMode[]).map(m => (
                  <button
                    key={m}
                    onClick={() => setViewMode(m)}
                    className={`px-3 py-1 text-xs font-medium transition-colors ${
                      viewMode === m ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    {m === 'daily' ? '📅 Daily' : '📆 Weekly'}
                  </button>
                ))}
              </div>

              <button
                onClick={() => setTab('config')}
                className="ml-auto text-blue-500 hover:underline font-medium"
              >
                Edit configuration →
              </button>
            </div>

            {viewMode === 'weekly' ? (
              <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-gray-400">
                <div className="text-4xl mb-3">📆</div>
                <p className="font-semibold text-gray-600 mb-2">Weekly view coming soon</p>
                <p className="text-sm max-w-md mx-auto">
                  Weekly scheduling requires visit data across multiple days — today only has <strong>17 Jun 2026</strong>.
                  Once the backend connects to real API data, the weekly view will let you:
                </p>
                <ul className="text-sm text-left max-w-md mx-auto mt-3 space-y-1">
                  <li>📋 See Red / Yellow / Green visits across Mon–Fri</li>
                  <li>⏩ Defer today's overload to tomorrow if nurses are at capacity</li>
                  <li>⚖️ Balance workload across the week (not just the day)</li>
                  <li>🔁 Carry forward unresolved conflicts to the next available slot</li>
                </ul>
              </div>
            ) : (
              <BatchResults results={results} clinicians={mockClinicians} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default App;
