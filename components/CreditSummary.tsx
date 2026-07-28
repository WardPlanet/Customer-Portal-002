import type { CreditSummaryTotals } from '@/lib/creditConfig'

const fmt = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

function StatCard({ label, value, classes }: { label: string; value: string; classes: string }) {
  return (
    <div className={`rounded-xl px-4 py-3.5 ${classes}`}>
      <div className="text-[11px] font-bold uppercase tracking-wide mb-1.5">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  )
}

export function CreditSummary({ summary, totalOffices }: { summary: CreditSummaryTotals; totalOffices: number }) {
  const { earned, pending, missed, creditPerOffice } = summary
  const potential = totalOffices * creditPerOffice

  return (
    <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 h-full">
      <div className="flex items-start justify-between mb-0.5">
        <h2 className="text-base font-bold text-gray-900">Credit Summary</h2>
        <svg className="w-4 h-4 text-gray-300 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>
      <p className="text-sm text-gray-500 mb-5">{fmt(creditPerOffice)} per office</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Earned"          value={fmt(earned)}    classes="bg-green-100 text-green-800" />
        <StatCard label="Pending"         value={fmt(pending)}   classes="bg-amber-100 text-amber-800" />
        <StatCard label="Missed"          value={fmt(missed)}    classes="bg-red-100 text-red-800" />
        <StatCard label="Total Potential" value={fmt(potential)} classes="bg-gray-100 text-gray-800" />
      </div>

      {missed > 0 && (
        <p className="mt-4 bg-red-100 text-red-800 text-xs rounded-lg px-3.5 py-2.5">
          Credits are all-or-nothing per office — missed offices cannot be recovered unless re-opened in the next window.
        </p>
      )}
    </section>
  )
}
