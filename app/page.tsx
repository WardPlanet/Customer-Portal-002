import Link from 'next/link'

const DEMO_CLIENTS = [
  { id: 'onboarding-template-001',      name: 'PDDS Onboarding Template', wave: 'Wave 1', software: 'Denticon', role: 'Client'   },
  { id: 'onboarding-template-001',      name: 'PDDS Team',                wave: 'Wave 1', software: 'Denticon', role: 'Internal' },
]

export default function Home() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <div className="flex items-center justify-center gap-2 mb-2">
            <span className="text-lg font-bold tracking-wider text-gray-400 uppercase">planet</span>
            <span className="text-lg font-black tracking-wider text-blue-700 uppercase">DDS</span>
          </div>
          <p className="text-sm text-gray-500">Onboarding Portal</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <h1 className="text-lg font-bold text-gray-900 mb-1">Welcome</h1>
          <p className="text-sm text-gray-500 mb-6">Select your profile to continue</p>
          <div className="space-y-3">
            {DEMO_CLIENTS.map((c, i) => (
              <Link key={i} href={`/${c.id}/dashboard`}
                className="flex items-center gap-4 p-4 border border-gray-200 rounded-xl hover:border-blue-400 hover:bg-blue-50/50 transition-all group">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white ${c.role === 'Internal' ? 'bg-blue-700' : 'bg-green-600'}`}>
                  {c.name[0]}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-900">{c.name}</p>
                  <p className="text-xs text-gray-400">{c.role} · {c.software} · {c.wave}</p>
                </div>
                <svg className="w-4 h-4 text-gray-300 group-hover:text-blue-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
