'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { Header } from '@/components/Header'
import { CreditAdminConfigPanel } from '@/components/CreditAdminConfigPanel'
import { CreditSummary } from '@/components/CreditSummary'
import { CreditOfficeTable } from '@/components/CreditOfficeTable'
import { CreditNotesSidebar } from '@/components/CreditNotesSidebar'
import { getClientById } from '@/lib/mockData'
import { useCreditCalculator } from '@/lib/creditCalculatorStore'

export default function CreditCalculatorPage() {
  const params = useParams()
  const client = getClientById(params.clientId as string)
  const { config, setConfig, offices, addOffice, updateOffice, removeOffice, comments, addComment, summary } = useCreditCalculator()

  const [isIC, setIsIC] = useState(true)
  const [activeOfficeId, setActiveOfficeId] = useState<number | null>(null)
  const activeOffice = offices.find(o => o.id === activeOfficeId) ?? null

  const noteCounts = Object.fromEntries(offices.map(o => [o.id, (comments[o.id] ?? []).length]))

  return (
    <>
      <Header client={client} showCeoView />
      <main className="max-w-4xl mx-auto px-6 py-10">

        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-blue-700 mb-1">Milestone Credits</h1>
            <p className="text-sm text-gray-500">Track go-live credits per location</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">View as:</span>
            <button
              onClick={() => setIsIC(true)}
              className={`px-3.5 py-1.5 rounded-lg text-sm border transition-colors ${isIC ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-700 hover:border-blue-300'}`}
            >
              IC (Admin)
            </button>
            <button
              onClick={() => setIsIC(false)}
              className={`px-3.5 py-1.5 rounded-lg text-sm border transition-colors ${!isIC ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-700 hover:border-blue-300'}`}
            >
              Client
            </button>
          </div>
        </div>

        {isIC && (
          <CreditAdminConfigPanel config={config} onChange={setConfig} />
        )}

        <div className="mb-6">
          <CreditSummary summary={summary} totalOffices={config.totalOffices} />
        </div>

        <CreditOfficeTable
          offices={offices}
          isIC={isIC}
          segment={config.segment}
          noteCounts={noteCounts}
          onUpdateOffice={updateOffice}
          onAddOffice={addOffice}
          onRemoveOffice={removeOffice}
          onOpenNotes={setActiveOfficeId}
        />
      </main>

      {activeOffice && (
        <CreditNotesSidebar
          office={activeOffice}
          comments={comments[activeOffice.id] ?? []}
          onAddComment={note => addComment(activeOffice.id, note)}
          onClose={() => setActiveOfficeId(null)}
        />
      )}
    </>
  )
}
