import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { IconTrash } from '../components/icons'
import { Badge, Button, Card, Empty, PageHeader, Pagination, Spinner, fmtDate, useConfirm, useToast } from '../components/ui'
import { deleteImportJobWithItems } from '../lib/actions'
import { useData } from '../lib/data'
import { supabase } from '../lib/supabase'

interface Job { id: string; filename: string; shop_id: string; survey_id: string; row_total: number; row_imported: number; row_skipped: number; row_errors: number; created_at: string; created_by: string | null }

export default function ImportHistory() {
  const { shopMap, memberName, reload } = useData()
  const toast = useToast()
  const confirm = useConfirm()
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [page, setPage] = useState(0)

  const loadJobs = () => {
    supabase.from('import_jobs').select('id,filename,shop_id,survey_id,row_total,row_imported,row_skipped,row_errors,created_at,created_by').order('created_at', { ascending: false }).limit(500).then((r) => setJobs((r.data ?? []) as Job[]))
  }
  useEffect(() => { loadJobs() }, [])

  const removeJob = async (j: Job) => {
    const ok = await confirm({
      title: `Delete import "${j.filename}"?`,
      body: 'This will remove this import record, its imported price records, and any products that have no offers from other imports.',
      confirmLabel: 'Delete import & items',
      danger: true,
    })
    if (!ok) return
    setDeletingId(j.id)
    try {
      const res = await deleteImportJobWithItems(j.id)
      await reload()
      loadJobs()
      toast('ok', `Deleted import (${res.deletedOffers} offers, ${res.deletedProducts} products removed)`)
    } catch (e) {
      toast('err', (e as Error).message)
    } finally {
      setDeletingId(null)
    }
  }

  if (!jobs) return <Spinner />
  const per = 25
  return (
    <div className="space-y-4">
      <PageHeader
        title="Import history"
        subtitle="Audit log of all CSV and Excel price lists imported into the shared workspace."
      />
      {jobs.length === 0 ? <Empty title="No imports yet"><Link className="underline" to="/import">Import a price list</Link></Empty> : (
        <div className="space-y-2">
          {jobs.slice(page * per, page * per + per).map((j) => (
            <Card key={j.id} className="!p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-[var(--text-primary)]" title={j.filename}>{j.filename}</div>
                  <div className="mt-0.5 text-xs text-[var(--text-secondary)]">{shopMap.get(j.shop_id)?.name} · {fmtDate(j.created_at)} · by {memberName(j.created_by)}</div>
                </div>
                <Button variant="danger" small disabled={deletingId === j.id} onClick={() => void removeJob(j)}>
                  <IconTrash size={14} />
                  <span>{deletingId === j.id ? 'Deleting…' : 'Delete'}</span>
                </Button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5"><Badge>{j.row_total} rows</Badge><Badge tone="green">{j.row_imported} imported</Badge>{j.row_skipped > 0 && <Badge tone="amber">{j.row_skipped} skipped</Badge>}{j.row_errors > 0 && <Badge tone="red">{j.row_errors} errors</Badge>}</div>
            </Card>
          ))}
        </div>
      )}
      <Pagination page={page} pages={Math.ceil(jobs.length / per)} onPage={setPage} />
    </div>
  )
}
