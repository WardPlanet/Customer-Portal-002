'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Client } from '@/lib/types'
import { EscalationDrawer } from '@/components/EscalationDrawer'

const SOFTWARE_SWITCH: Record<string, string> = {
  'onboarding-template-001':      'onboarding-template-c9-001',
  'onboarding-template-c9-001':   'onboarding-template-001',
}

type HeaderProps = { client: Client; currentPage?: 'dashboard' | 'tasks' | 'tracker'; showCeoView?: boolean }

export function Header({ client, currentPage, showCeoView }: HeaderProps) {
  const router = useRouter()
  const [softwareOpen,    setSoftwareOpen]    = useState(false)
  const [escalationOpen,  setEscalationOpen]  = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const isDenticon = client.software_type === 'denticon'
  const altClientId = SOFTWARE_SWITCH[client.id]

  useEffect(() => {
    function handle(e: MouseEvent) { if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setSoftwareOpen(false) }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  return (
    <>
    <header className="border-b border-gray-200 bg-white sticky top-0 z-40">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-1.5">
            {/* P-flag mark: PDDS Blue · Wordmark: PDDS Dark Blue — per brand guide */}
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-sm bg-blue-600 flex-shrink-0">
              <span className="text-[9px] font-black text-white leading-none tracking-tight">P</span>
            </span>
            <span className="text-[13px] font-bold tracking-wide text-blue-700 leading-none">
              Planet <span className="text-blue-600">DDS</span>
            </span>
          </Link>
          <span className="text-gray-300">/</span>
          <span className="text-sm font-semibold text-gray-800">{client.name}</span>

          {/* Software switcher */}
          {altClientId && (
            <div className="relative" ref={dropdownRef}>
              <button onClick={() => setSoftwareOpen(o => !o)}
                className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border border-gray-200 hover:border-blue-300 bg-white text-gray-600 hover:text-blue-600 transition-colors">
                {isDenticon ? 'Denticon' : 'Cloud 9'}
                <svg className={`w-3 h-3 transition-transform ${softwareOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
              </button>
              {softwareOpen && (
                <div className="absolute left-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg py-1 min-w-[130px] z-50">
                  <button onClick={() => { setSoftwareOpen(false); router.push(`/${isDenticon ? client.id : altClientId}/${currentPage ?? 'dashboard'}`) }}
                    className={`w-full text-left px-4 py-2 text-sm font-medium transition-colors ${isDenticon ? 'text-blue-600 bg-blue-50' : 'text-gray-700 hover:bg-gray-50'}`}>
                    Denticon {isDenticon && '✓'}
                  </button>
                  <button onClick={() => { setSoftwareOpen(false); router.push(`/${isDenticon ? altClientId : client.id}/${currentPage ?? 'dashboard'}`) }}
                    className={`w-full text-left px-4 py-2 text-sm font-medium transition-colors ${!isDenticon ? 'text-orange-600 bg-orange-50' : 'text-gray-700 hover:bg-gray-50'}`}>
                    Cloud 9 {!isDenticon && '✓'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex items-center gap-1">
          {[
            { href: `/${client.id}/dashboard`, label: 'Dashboard', page: 'dashboard' },
            { href: `/${client.id}/tasks`,     label: 'Tasks',     page: 'tasks'     },
            { href: `/${client.id}/tracker`,   label: 'Tracker',   page: 'tracker'   },
          ].map(({ href, label, page }) => (
            <Link key={page} href={href}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${currentPage === page ? 'bg-blue-100 text-blue-700 font-semibold' : 'text-gray-500 hover:text-blue-700 hover:bg-blue-50'}`}>
              {label}
            </Link>
          ))}
          {/* Escalations button */}
          <button
            onClick={() => setEscalationOpen(true)}
            className="ml-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-700 text-white transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            Escalations
          </button>

          {showCeoView && (
            <Link href="/admin/ceo" className="ml-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors border border-gray-200">
              CEO View
            </Link>
          )}
        </nav>
      </div>
    </header>

    <EscalationDrawer open={escalationOpen} onClose={() => setEscalationOpen(false)} />
    </>
  )
}
