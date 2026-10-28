import { useState } from 'react'
import type { OfferView } from '../lib/compare'
import type { PriceRecord, Shop } from '../lib/types'
import { Badge, cx, fmtDate, rs } from './ui'

const REASON: Record<string, string> = {
  review: 'Scheme needs review: not ranked',
  invalid: 'Invalid or missing price: not ranked',
  unavailable: 'Reported unavailable: not ranked',
  stale: 'Outdated: excluded by freshness filter',
  expired: 'Quote expired: not ranked',
  archived: 'Archived',
}

export function MatchBadge({ status }: { status: PriceRecord['match_status'] }) {
  const map = {
    exact: ['green', 'Exact match'], high: ['green', 'High confidence'], manual: ['blue', 'Confirmed by user'],
    needs_review: ['amber', 'Needs review'], unmatched: ['slate', 'Unmatched'], conflicting: ['red', 'Conflicting attributes'],
  } as const
  const [tone, label] = map[status]
  return <Badge tone={tone}>{label}</Badge>
}

export function FreshBadge({ ageDays, fresh }: { ageDays: number; fresh: boolean }) {
  return fresh ? <Badge tone="green">Recent · {ageDays}d old</Badge> : <Badge tone="amber">Possibly outdated · {ageDays}d old</Badge>
}

export function OfferCard({ o, shop, extra }: { o: OfferView; shop: Shop | undefined; extra?: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const r = o.rec
  const best = o.isBest
  return (
    <div className={cx('rounded-xl border p-3', best ? 'border-emerald-600 bg-emerald-50 ring-2 ring-emerald-600' : o.eligible ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50 opacity-90')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-bold">{shop?.name ?? 'Unknown shop'}</span>
            {best && <Badge tone="solid">{o.isTied ? 'BEST PRICE (TIED)' : 'BEST PRICE'}</Badge>}
          </div>
          <div className="text-xs text-slate-600">Price list date: {fmtDate(r.observed_on)}{shop?.city ? ` · ${shop.city}` : ''}</div>
        </div>
        <div className="text-right">
          <div className={cx('text-xl font-extrabold', best ? 'text-emerald-800' : 'text-slate-900')}>{o.eligible ? rs(o.cents! / 100) : '—'}</div>
          <div className="text-xs text-slate-600">effective purchase price</div>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm sm:grid-cols-4">
        <div><span className="text-slate-500">Offer rate </span><b>{rs(r.base_price)}</b></div>
        <div><span className="text-slate-500">Discount / scheme </span><b>{r.scheme_text || '—'}</b></div>
        {r.pack_size != null && <div><span className="text-slate-500">Pack </span><b>{r.pack_size}</b></div>}
        {o.perUnit && <div><span className="text-slate-500">{o.perUnit.label} </span><b>{rs(o.perUnit.value, 3)}</b></div>}
        {r.mrp != null && <div><span className="text-slate-500">MRP </span><b>{rs(r.mrp)}</b></div>}
        {r.availability && <div><span className="text-slate-500">Stock </span><b>{r.availability}</b></div>}
        {o.aboveBest != null && o.aboveBest > 0 && <div className="col-span-2"><span className="text-slate-500">Above best </span><b>+{rs(o.aboveBest)}</b></div>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <FreshBadge ageDays={o.ageDays} fresh={o.fresh} />
        <MatchBadge status={r.match_status} />
        {!o.eligible && o.reason && <Badge tone="amber">{REASON[o.reason]}</Badge>}
        {r.scheme_status === 'review' && <Badge tone="amber">Calculation needs review</Badge>}
        {!o.fresh && <span className="text-xs text-slate-600">Historical information, not a guaranteed current offer.</span>}
      </div>
      <div className="mt-1 text-xs text-slate-500">Shop's product name: “{r.original_title}”{r.original_code ? ` · code ${r.original_code}` : ''}{r.notes ? ` · note: ${r.notes}` : ''}</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {r.calc_notes && <button className="text-sm font-medium text-emerald-800 underline" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'} calculation</button>}
        {extra}
      </div>
      {open && r.calc_notes && <pre className="mt-2 whitespace-pre-wrap rounded bg-white p-2 text-xs text-slate-700">{r.calc_notes}</pre>}
    </div>
  )
}
