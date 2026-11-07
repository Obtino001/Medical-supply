import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { IconEdit, IconPlus, IconTrash, IconUpload } from '../components/icons'
import { ShopForm } from '../components/ShopForm'
import { Badge, Button, Card, Empty, Input, PageHeader, Select, fmtDate, useConfirm, useToast } from '../components/ui'
import { deleteShopWithItems } from '../lib/actions'
import { useData } from '../lib/data'
import type { Shop } from '../lib/types'

export default function Shops() {
  const { shops, surveys, current, reload } = useData()
  const toast = useToast()
  const confirm = useConfirm()
  const [q, setQ] = useState('')
  const [city, setCity] = useState('')
  const [status, setStatus] = useState('active')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Shop | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const lastSurvey = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of surveys) if (!m.has(s.shop_id) || s.survey_date > m.get(s.shop_id)!) m.set(s.shop_id, s.survey_date)
    return m
  }, [surveys])

  const itemCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of current) m.set(r.shop_id, (m.get(r.shop_id) ?? 0) + 1)
    return m
  }, [current])

  const cities = [...new Set(shops.map((s) => s.city).filter((c): c is string => !!c))].sort()
  const list = shops.filter(
    (s) =>
      (!status || s.status === status) &&
      (!city || s.city === city) &&
      (!q || [s.name, s.owner_name, s.phone, s.address, s.city].filter(Boolean).join(' ').toLowerCase().includes(q.toLowerCase())),
  )

  const handleDelete = async (shop: Shop) => {
    const count = itemCounts.get(shop.id) ?? 0
    const ok = await confirm({
      title: `Delete "${shop.name}" and its items?`,
      body: `This will permanently delete "${shop.name}", all of its price records (${count} current offers), surveys, import history, and any products that only belong to this shop.`,
      confirmLabel: 'Delete shop & items',
      danger: true,
    })
    if (!ok) return
    setDeletingId(shop.id)
    try {
      const res = await deleteShopWithItems(shop.id)
      await reload()
      toast('ok', `Deleted "${shop.name}" (${res.deletedOffers} offers, ${res.deletedProducts} products removed)`)
    } catch (e) {
      toast('err', (e as Error).message)
      await reload()
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        title="Shops"
        subtitle="Manage wholesale suppliers and market shops across Karachi, Nawabshah, and regional hubs."
      >
        <Button small onClick={() => setAdding(true)}>
          <IconPlus size={15} />
          <span>Add shop</span>
        </Button>
      </PageHeader>
      <Card className="!p-3">
        <div className="grid gap-2.5 sm:grid-cols-3">
          <Input type="search" placeholder="Search shops…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select value={city} onChange={(e) => setCity(e.target.value)}>
            <option value="">All cities</option>
            {cities.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="">All</option>
          </Select>
        </div>
      </Card>
      {list.length === 0 ? (
        <Empty title="No shops yet">Add your first shop, then import its price list.</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {list.map((s) => {
            const count = itemCounts.get(s.id) ?? 0
            const isDeleting = deletingId === s.id
            return (
              <Card key={s.id} className="flex flex-col justify-between !p-4 transition-colors hover:border-[var(--border-strong)]">
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      to={`/shops/${s.id}`}
                      className="min-w-0 truncate text-[15px] font-medium text-[var(--text-primary)] hover:text-[var(--color-primary)] hover:underline"
                    >
                      {s.name}
                    </Link>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Badge tone="slate">{count} items</Badge>
                      {s.status === 'archived' ? <Badge tone="amber">Archived</Badge> : <Badge tone="blue">{s.city || 'Supplier'}</Badge>}
                    </div>
                  </div>
                  <div className="mt-1 truncate text-xs text-[var(--text-secondary)]">
                    {[s.city, s.address].filter(Boolean).join(' · ') || 'No location recorded'}
                  </div>
                  {[s.owner_name, s.phone].some(Boolean) && (
                    <div className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">
                      {[s.owner_name, s.phone].filter(Boolean).join(' · ')}
                    </div>
                  )}
                  <div className="mt-2 text-xs text-[var(--text-secondary)]">
                    Last survey: <span className="font-medium text-[var(--text-primary)] tabular-nums">{fmtDate(lastSurvey.get(s.id))}</span>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-default)] pt-2.5">
                  <div className="flex items-center gap-1.5">
                    <Link to={`/shops/${s.id}`}>
                      <Button variant="secondary" small>
                        <span>View items ({count})</span>
                      </Button>
                    </Link>
                    <Link to={`/import?shop=${s.id}`}>
                      <Button variant="ghost" small title="Import price list for this shop">
                        <IconUpload size={14} />
                        <span>Import</span>
                      </Button>
                    </Link>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Button variant="secondary" small onClick={() => setEditing(s)} title="Edit shop">
                      <IconEdit size={14} />
                      <span>Edit</span>
                    </Button>
                    <Button
                      variant="danger"
                      small
                      disabled={isDeleting}
                      onClick={() => void handleDelete(s)}
                      title="Delete shop and its items"
                    >
                      <IconTrash size={14} />
                      <span>{isDeleting ? 'Deleting…' : 'Delete'}</span>
                    </Button>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
      {adding && <ShopForm open onClose={() => setAdding(false)} onSaved={reload} />}
      {editing && <ShopForm open shop={editing} onClose={() => setEditing(null)} onSaved={reload} />}
    </div>
  )
}
