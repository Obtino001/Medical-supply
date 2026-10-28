import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, Empty, Modal, PageHeader, Pagination, Textarea, fmtDate, useToast } from '../components/ui'
import { useData } from '../lib/data'
import { updateChecked } from '../lib/supabase'
import type { Survey } from '../lib/types'

export default function Surveys() {
  const { surveys, shopMap, memberName, reload } = useData()
  const toast = useToast()
  const [edit, setEdit] = useState<Survey | null>(null)
  const [note, setNote] = useState('')
  const [page, setPage] = useState(0)
  const per = 30
  const save = async () => {
    if (!edit) return
    try { await updateChecked('surveys', edit.id, (edit as Survey & { updated_at: string }).updated_at, { notes: note.trim() || null }); await reload(); setEdit(null); toast('ok', 'Survey note saved') }
    catch (e) { toast('err', (e as Error).message); await reload() }
  }
  return (
    <div>
      <PageHeader title="Surveys"><Link to="/import"><Button>+ Create survey (import a price list)</Button></Link></PageHeader>
      <p className="mb-3 text-sm text-slate-600">A survey is one visit to one shop. It is created when you import that shop's price list, so surveys always have data behind them.</p>
      {surveys.length === 0 ? <Empty title="No surveys yet" /> : (
        <div className="space-y-2">
          {surveys.slice(page * per, page * per + per).map((s) => (
            <Card key={s.id} className="!p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><b>Survey #{s.survey_no}</b> · {shopMap.get(s.shop_id)?.name ?? 'Shop'} · {fmtDate(s.survey_date)}</div>
                <Button variant="ghost" small onClick={() => { setEdit(s); setNote(s.notes ?? '') }}>Edit note</Button>
              </div>
              <div className="text-xs text-slate-500">Created by {memberName(s.created_by)} on {fmtDate(s.created_at)}</div>
              {s.notes && <div className="mt-1 text-sm text-slate-700">{s.notes}</div>}
            </Card>
          ))}
        </div>
      )}
      <Pagination page={page} pages={Math.ceil(surveys.length / per)} onPage={setPage} />
      <Modal open={!!edit} onClose={() => setEdit(null)} title="Survey note">
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="mt-3 flex justify-end gap-2"><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save}>Save</Button></div>
      </Modal>
    </div>
  )
}
