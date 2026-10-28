import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { IconPlus } from '../components/icons'
import { ShopForm } from '../components/ShopForm'
import { Badge, Button, Card, Empty, Input, PageHeader, Select, fmtDate } from '../components/ui'
import { useData } from '../lib/data'

export default function Shops() {
  const { shops, surveys, reload } = useData()
  const [q, setQ] = useState('')
  const [city, setCity] = useState('')
  const [status, setStatus] = useState('active')
  const [adding, setAdding] = useState(false)
  const lastSurvey = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of surveys) if (!m.has(s.shop_id) || s.survey_date > m.get(s.shop_id)!) m.set(s.shop_id, s.survey_date)
    return m
  }, [surveys])
  const cities = [...new Set(shops.map((s) => s.city).filter((c): c is string => !!c))].sort()
  const list = shops.filter((s) => (!status || s.status === status) && (!city || s.city === city) &&
    (!q || [s.name, s.owner_name, s.phone, s.address, s.city].filter(Boolean).join(' ').toLowerCase().includes(q.toLowerCase())))
  return (
    <div className="space-y-4">
      <PageHeader
        title="Shops"
        subtitle="Manage wholesale suppliers and market shops across Karachi, Nawabshah, and regional hubs."
      >
        <Button onClick={() => setAdding(true)}>
          <IconPlus size={15} />
          <span>Add shop</span>
        </Button>
      </PageHeader>
      <Card className="!p-3.5">
        <div className="grid gap-2.5 sm:grid-cols-3">
          <Input type="search" placeholder="Search shops…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select value={city} onChange={(e) => setCity(e.target.value)}><option value="">All cities</option>{cities.map((c) => <option key={c}>{c}</option>)}</Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="active">Active</option><option value="archived">Archived</option><option value="">All</option></Select>
        </div>
      </Card>
      {list.length === 0 ? <Empty title="No shops yet">Add your first shop, then import its price list.</Empty> : (
        <div className="grid gap-3 sm:grid-cols-2">
          {list.map((s) => (
            <Link key={s.id} to={`/shops/${s.id}`}>
              <Card className="transition-colors hover:border-[#1A73E8] hover:bg-[#F8F9FA]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[15px] font-medium text-[#202124]">{s.name}</span>
                  {s.status === 'archived' ? <Badge tone="amber">Archived</Badge> : <Badge tone="blue">{s.city || 'Supplier'}</Badge>}
                </div>
                <div className="mt-1 text-xs text-[#5F6368]">{[s.city, s.address].filter(Boolean).join(' · ') || 'No location recorded'}</div>
                {([s.owner_name, s.phone].some(Boolean)) && <div className="mt-0.5 text-xs text-[#5F6368]">{[s.owner_name, s.phone].filter(Boolean).join(' · ')}</div>}
                <div className="mt-2 text-xs text-[#5F6368]">Last survey: <span className="font-medium text-[#202124]">{fmtDate(lastSurvey.get(s.id))}</span></div>
              </Card>
            </Link>
          ))}
        </div>
      )}
      {adding && <ShopForm open onClose={() => setAdding(false)} onSaved={reload} />}
    </div>
  )
}
