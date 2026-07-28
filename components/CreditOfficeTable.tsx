import type { CreditOffice, OfficeStatus, Segment } from '@/lib/creditConfig'

const STATUS_OPTIONS: { value: OfficeStatus; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'live',    label: 'Live'    },
  { value: 'missed',  label: 'Missed'  },
]

const STATUS_CLASSES: Record<OfficeStatus, string> = {
  pending: 'bg-amber-100 text-amber-700 border-amber-200',
  live:    'bg-green-100 text-green-700 border-green-200',
  missed:  'bg-red-100 text-red-700 border-red-200',
}

type CreditOfficeTableProps = {
  offices:        CreditOffice[]
  isIC:           boolean
  segment:        Segment
  noteCounts:     Record<number, number>
  onUpdateOffice: (id: number, updates: Partial<CreditOffice>) => void
  onAddOffice:    () => void
  onRemoveOffice: (id: number) => void
  onOpenNotes:    (id: number) => void
}

export function CreditOfficeTable({ offices, isIC, segment, noteCounts, onUpdateOffice, onAddOffice, onRemoveOffice, onOpenNotes }: CreditOfficeTableProps) {
  const waves = [...new Set(offices.map(o => o.wave))].sort((a, b) => a - b)

  return (
    <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-bold text-gray-900">Office Tracker</h2>
        {isIC && (
          <button onClick={onAddOffice} className="px-3.5 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg transition-colors">
            + Add Office
          </button>
        )}
      </div>

      {segment === 'enterprise' && (
        <p className="bg-amber-50 border border-amber-200 rounded-lg px-3.5 py-2.5 text-xs text-amber-800 mb-4">
          Enterprise mode: credits are <strong>all-or-nothing per wave</strong>. Every office in a wave must go live to earn credit for that wave.
        </p>
      )}

      {waves.map(wave => (
        <div key={wave} className="mb-6 last:mb-0">
          <h3 className="text-sm font-semibold text-gray-600 border-b border-gray-100 pb-1.5 mb-2">Wave {wave}</h3>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="text-left text-xs font-semibold text-gray-500 border-b-2 border-gray-200 py-2 px-3">Office Name</th>
                <th className="text-left text-xs font-semibold text-gray-500 border-b-2 border-gray-200 py-2 px-3">Target Go-Live</th>
                <th className="text-left text-xs font-semibold text-gray-500 border-b-2 border-gray-200 py-2 px-3">Status</th>
                {isIC && <th className="text-left text-xs font-semibold text-gray-500 border-b-2 border-gray-200 py-2 px-3">Notes</th>}
                {isIC && <th className="border-b-2 border-gray-200 py-2 px-3" />}
              </tr>
            </thead>
            <tbody>
              {offices.filter(o => o.wave === wave).map(office => (
                <CreditOfficeRow
                  key={office.id}
                  office={office}
                  isIC={isIC}
                  noteCount={noteCounts[office.id] ?? 0}
                  onUpdate={updates => onUpdateOffice(office.id, updates)}
                  onRemove={() => onRemoveOffice(office.id)}
                  onOpenNotes={() => onOpenNotes(office.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {offices.length === 0 && (
        <p className="text-center text-gray-400 italic py-6">
          No offices added yet.{isIC ? ' Click "+ Add Office" to get started.' : ''}
        </p>
      )}
    </section>
  )
}

function CreditOfficeRow({ office, isIC, noteCount, onUpdate, onRemove, onOpenNotes }: {
  office:      CreditOffice
  isIC:        boolean
  noteCount:   number
  onUpdate:    (updates: Partial<CreditOffice>) => void
  onRemove:    () => void
  onOpenNotes: () => void
}) {
  return (
    <tr>
      <td className="py-2 px-3 border-b border-gray-50 align-middle">
        {isIC ? (
          <input
            value={office.name}
            onChange={e => onUpdate({ name: e.target.value })}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
          />
        ) : office.name}
      </td>
      <td className="py-2 px-3 border-b border-gray-50 align-middle">
        {isIC ? (
          <input
            type="date"
            value={office.targetDate}
            onChange={e => onUpdate({ targetDate: e.target.value })}
            className="px-2 py-1 border border-gray-300 rounded text-sm"
          />
        ) : (office.targetDate || '—')}
      </td>
      <td className="py-2 px-3 border-b border-gray-50 align-middle">
        {isIC ? (
          <select
            value={office.status}
            onChange={e => onUpdate({ status: e.target.value as OfficeStatus })}
            className={`px-2 py-1 border rounded text-sm font-medium ${STATUS_CLASSES[office.status]}`}
          >
            {STATUS_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        ) : (
          <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium border ${STATUS_CLASSES[office.status]}`}>
            {STATUS_OPTIONS.find(o => o.value === office.status)?.label}
          </span>
        )}
      </td>
      {isIC && (
        <td className="py-2 px-3 border-b border-gray-50 align-middle">
          <button onClick={onOpenNotes} className="inline-flex items-center gap-1.5 px-3 py-1 border border-gray-300 rounded-lg text-xs hover:bg-gray-50 transition-colors">
            Notes{noteCount > 0 && <span className="bg-blue-600 text-white rounded-full text-[10px] px-1.5 py-0.5 font-semibold">{noteCount}</span>}
          </button>
        </td>
      )}
      {isIC && (
        <td className="py-2 px-3 border-b border-gray-50 align-middle">
          <button onClick={onRemove} title="Remove office" className="text-red-500 hover:text-red-700 text-base px-1.5">✕</button>
        </td>
      )}
    </tr>
  )
}
