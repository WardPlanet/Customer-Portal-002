import { getDealSizeTier } from '@/lib/creditConfig'
import type { CreditConfig, DealTier, Pace, Segment } from '@/lib/creditConfig'

const PACE_OPTIONS: { value: Pace; label: string }[] = [
  { value: 'standard', label: 'Standard (~$2k/location)' },
  { value: 'hyper',    label: 'Hyper/Aggressive (~$3k/location)' },
]
const SEGMENT_OPTIONS: { value: Segment; label: string }[] = [
  { value: 'commercial', label: 'Commercial' },
  { value: 'enterprise', label: 'Enterprise' },
]
const TIERS: DealTier[] = ['small', 'mid', 'large']
const TIER_LABELS: Record<DealTier, string> = { small: '1–50 offices', mid: '51–100 offices', large: '101+ offices' }

export function CreditAdminConfigPanel({ config, onChange }: { config: CreditConfig; onChange: (config: CreditConfig) => void }) {
  const { pace, segment, totalOffices, rateTable } = config
  const activeTier = getDealSizeTier(totalOffices)

  function setField<K extends keyof CreditConfig>(field: K, value: CreditConfig[K]) {
    onChange({ ...config, [field]: value })
  }

  function setRate(paceKey: Pace, tier: DealTier, value: string) {
    onChange({
      ...config,
      rateTable: {
        ...rateTable,
        [paceKey]: { ...rateTable[paceKey], [tier]: Number(value) },
      },
    })
  }

  return (
    <section className="bg-gray-50 border border-gray-200 rounded-2xl shadow-sm p-6 mb-6">
      <h2 className="flex items-center gap-2.5 text-base font-bold text-gray-900 mb-5">
        Deal Configuration
        <span className="bg-gray-500 text-white text-[10px] font-semibold px-2 py-0.5 rounded">IC Only</span>
      </h2>

      <div className="flex items-center gap-3 mb-4">
        <label className="w-48 text-sm font-medium text-gray-700">Segment</label>
        <div className="flex gap-2">
          {SEGMENT_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setField('segment', opt.value)}
              className={`px-3.5 py-1.5 rounded-lg text-sm border transition-colors ${segment === opt.value ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-700 hover:border-blue-300'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <label className="w-48 text-sm font-medium text-gray-700">Rollout Pace</label>
        <div className="flex gap-2">
          {PACE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setField('pace', opt.value)}
              className={`px-3.5 py-1.5 rounded-lg text-sm border transition-colors ${pace === opt.value ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-700 hover:border-blue-300'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 mb-2">
        <label className="w-48 text-sm font-medium text-gray-700">Total Offices in Deal</label>
        <input
          type="number"
          min={1}
          value={totalOffices}
          onChange={e => setField('totalOffices', Math.max(1, Number(e.target.value)))}
          className="w-20 px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm"
        />
        <span className="bg-gray-200 text-gray-600 text-xs px-2 py-1 rounded">{TIER_LABELS[activeTier]}</span>
      </div>

      <details className="mt-2">
        <summary className="cursor-pointer text-sm font-medium text-blue-600">Edit Rate Table</summary>
        <table className="w-full border-collapse mt-3">
          <thead>
            <tr>
              <th className="text-left text-xs font-semibold text-gray-600 border-b-2 border-gray-200 py-2 px-3">Tier</th>
              <th className="text-left text-xs font-semibold text-gray-600 border-b-2 border-gray-200 py-2 px-3">Standard ($/office)</th>
              <th className="text-left text-xs font-semibold text-gray-600 border-b-2 border-gray-200 py-2 px-3">Hyper ($/office)</th>
            </tr>
          </thead>
          <tbody>
            {TIERS.map(tier => (
              <tr key={tier} className={tier === activeTier ? 'bg-amber-50' : ''}>
                <td className="py-2 px-3 border-b border-gray-200 text-sm">
                  {TIER_LABELS[tier]}
                  {tier === activeTier && <span className="text-amber-700 text-xs"> ← active</span>}
                </td>
                <td className="py-2 px-3 border-b border-gray-200">
                  <input
                    type="number"
                    value={rateTable.standard[tier]}
                    onChange={e => setRate('standard', tier, e.target.value)}
                    className="w-24 px-2 py-1 border border-gray-300 rounded text-sm"
                  />
                </td>
                <td className="py-2 px-3 border-b border-gray-200">
                  <input
                    type="number"
                    value={rateTable.hyper[tier]}
                    onChange={e => setRate('hyper', tier, e.target.value)}
                    className="w-24 px-2 py-1 border border-gray-300 rounded text-sm"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  )
}
