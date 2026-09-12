'use client'

// QR deep-link import page (Opción B — claim autocontenido). The export QR on
// device A points here as /sync-import?claim=<token>. The claim token alone
// redeems the anonymous claim, so the modal prefills and auto-runs the import;
// a bare visit degrades to the generic import dialog (camera / manual tab).
import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import SyncQrModal from '@/components/sync/sync-qr-modal'
import { useLanguage } from '@/contexts/language-context'

function SyncImportContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { t } = useLanguage()
  const claim = searchParams.get('claim')
  const [open, setOpen] = useState(true)

  const initialToken = claim ?? undefined

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4">
      <h1 className="sr-only">{t('sync.import.title')}</h1>
      <SyncQrModal
        open={open}
        mode="import"
        initialToken={initialToken}
        onOpenChange={(next) => {
          if (!next) {
            setOpen(false)
            router.replace('/')
          }
        }}
      />
    </main>
  )
}

export default function SyncImportPage() {
  return (
    <Suspense fallback={null}>
      <SyncImportContent />
    </Suspense>
  )
}