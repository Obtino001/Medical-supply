import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Card, Empty, PageHeader, Pagination, Spinner, fmtDate } from '../components/ui'
import { useData } from '../lib/data'
import { supabase } from '../lib/supabase'

interface Job { id: string; filename: string; shop_id: string; survey_id: string; row_total: number; row_imported: number; row_skipped: number; row_errors: number; created_at: string; created_by: string | null }

export default function ImportHistory() {
  const { shopMap, memberName } = useData()
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [page, setPage] = useState(0)
  useEffect(() => {
    supabase.from('import_jobs').select('id,filename,shop_id,survey_id,row_total,row_imported,row_skipped,row_errors,created_at,created_by').order('created_at', { ascending: false }).limit(500).then((r) => setJobs((r.data ?? []) as Job[]))
  }, [])
  if (!jobs) return <Spinner />
  const per = 25
  return (
    <div>
      <PageHeader title="Import history" />
      {jobs.length === 0 ? <Empty title="No imports yet"><Link className="underline" to="/import">Import a price list</Link></Empty> : (
        <div className="space-y-2">
          {jobs.slice(page * per, page * per + per).map((j) => (
            <Card key={j.id} className="!p-3">
              <div className="font-semibold break-all">{j.filename}</div>
              <div className="text-sm text-slate-600">{shopMap.get(j.shop_id)?.name} · {fmtDate(j.created_at)} · by {memberName(j.created_by)}</div>
              <div className="mt-1 flex flex-wrap gap-1.5"><Badge>{j.row_total} rows</Badge><Badge tone="green">{j.row_imported} imported</Badge>{j.row_skipped > 0 && <Badge tone="amber">{j.row_skipped} skipped</Badge>}{j.row_errors > 0 && <Badge tone="red">{j.row_errors} errors</Badge>}</div>
            </Card>
          ))}
        </div>
      )}
      <Pagination page={page} pages={Math.ceil(jobs.length / per)} onPage={setPage} />
    </div>
  )
}
