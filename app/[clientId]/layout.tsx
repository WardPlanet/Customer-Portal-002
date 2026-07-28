import { ClientTasksProvider } from '@/lib/clientTasksContext'
import { DenticonCardProvider } from '@/lib/denticonCardStore'
import { Cloud9CardProvider } from '@/lib/cloud9CardStore'
import { GoLiveDatesProvider } from '@/lib/goLiveDatesStore'
import { PracticeWavesProvider } from '@/lib/practiceWavesStore'
import { TrackerNotesProvider } from '@/lib/trackerNotesStore'
import { CustomOfficesProvider } from '@/lib/customOfficesStore'
import { TrackerActivityLogProvider } from '@/lib/trackerActivityLog'
import { CreditCalculatorProvider } from '@/lib/creditCalculatorStore'

export default async function ClientLayout({ children, params }: { children: React.ReactNode; params: Promise<{ clientId: string }> }) {
  const { clientId } = await params
  return (
    <GoLiveDatesProvider>
      <PracticeWavesProvider>
        <CustomOfficesProvider>
          <TrackerActivityLogProvider>
            <TrackerNotesProvider>
              <DenticonCardProvider>
                <Cloud9CardProvider>
                  <ClientTasksProvider clientId={clientId}>
                    <CreditCalculatorProvider clientId={clientId}>{children}</CreditCalculatorProvider>
                  </ClientTasksProvider>
                </Cloud9CardProvider>
              </DenticonCardProvider>
            </TrackerNotesProvider>
          </TrackerActivityLogProvider>
        </CustomOfficesProvider>
      </PracticeWavesProvider>
    </GoLiveDatesProvider>
  )
}
