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
    exact: ['green', 'Exact match'],
    high: ['green', 'High confidence'],
    manual: ['blue', 'Confirmed by user'],
    needs_review: ['amber', 'Needs review'],
    unmatched: ['slate', 'Unmatched'],
    conflicting: ['red', 'Conflicting attributes'],
  } as const
  const [tone, label] = map[status]
  return <Badge tone={tone}>{label}</Badge>
}

export function FreshBadge({ ageDays, fresh }: { ageDays: number; fresh: boolean }) {
  return fresh ? <Badge tone="green">Recent · {ageDays}d old</Badge> : <Badge tone="amber">Outdated · {ageDays}d old</Badge>
}

export function OfferCard({ o, shop, extra }: { o: OfferView; shop: Shop | undefined; extra?: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const r = o.rec
  const best = o.isBest
  return (
    <div
      className={cx(
        'rounded-xl border p-3.5 transition-colors',
        best
          ? 'border-emerald-500 bg-emerald-50/50 ring-1 ring-emerald-500/50'
          : o.eligible
            ? 'border-slate-200 bg-slate-50/40'
            : 'border-slate-200 bg-slate-50/80 opacity-85',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-900 sm:text-base">{shop?.name ?? 'Unknown shop'}</span>
            {best && <Badge tone="solid">{o.isTied ? 'BEST PRICE (TIED)' : 'BEST PRICE'}</Badge>}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">
            Price list date: <span className="font-medium text-slate-700 tabular-nums">{fmtDate(r.observed_on)}</span>
            {shop?.city ? ` · ${shop.city}` : ''}
          </div>
        </div>
        <div className="text-right">
          <div className={cx('text-lg font-bold tabular-nums sm:text-xl', best ? 'text-emerald-700' : 'text-slate-900')}>
            {o.eligible ? rs(o.cents! / 100) : '—'}
          </div>
          <div className="text-[11px] font-medium text-slate-500">effective purchase price</div>
        </div>
      </div>

      <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg border border-slate-200/70 bg-white px-3 py-2 text-xs sm:grid-cols-4 sm:text-sm">
        <div>
          <span className="block text-[11px] text-slate-400">Original offer rate</span>
          <b className="font-semibold text-slate-800 tabular-nums">{rs(r.base_price)}</b>
        </div>
        <div>
          <span className="block text-[11px] text-slate-400">Discount / scheme</span>
          <b className="font-semibold text-slate-800">{r.scheme_text || 'None'}</b>
        </div>
        {r.pack_size != null && (
          <div>
            <span className="block text-[11px] text-slate-400">Pack size</span>
            <b className="font-semibold text-slate-800 tabular-nums">{r.pack_size}</b>
          </div>
        )}
        {o.perUnit && (
          <div>
            <span className="block text-[11px] text-slate-400">{o.perUnit.label}</span>
            <b className="font-semibold text-slate-800 tabular-nums">{rs(o.perUnit.value, 3)}</b>
          </div>
        )}
        {r.mrp != null && (
          <div>
            <span className="block text-[11px] text-slate-400">MRP</span>
            <b className="font-semibold text-slate-800 tabular-nums">{rs(r.mrp)}</b>
          </div>
        )}
        {r.availability && (
          <div>
            <span className="block text-[11px] text-slate-400">Stock</span>
            <b className="font-semibold text-slate-800">{r.availability}</b>
          </div>
        )}
        {o.aboveBest != null && o.aboveBest > 0 && (
          <div className="col-span-2">
            <span className="block text-[11px] text-slate-400">Difference vs best</span>
            <b className="font-semibold text-slate-700 tabular-nums">+{rs(o.aboveBest)}</b>
          </div>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <FreshBadge ageDays={o.ageDays} fresh={o.fresh} />
        <MatchBadge status={r.match_status} />
        {!o.eligible && o.reason && <Badge tone="amber">{REASON[o.reason]}</Badge>}
        {r.scheme_status === 'review' && <Badge tone="amber">Calculation needs review</Badge>}
      </div>

      <div className="mt-1.5 text-xs text-slate-500">
        Shop's item name: <span className="font-medium text-slate-700">“{r.original_title}”</span>
        {r.original_code ? ` · code ${r.original_code}` : ''}
        {r.notes ? ` · note: ${r.notes}` : ''}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        {r.calc_notes && (
          <button type="button" className="text-xs font-semibold text-teal-800 hover:underline" onClick={() => setOpen(!open)}>
            {open ? 'Hide calculation steps' : 'Show calculation steps'}
          </button>
        )}
        {extra}
      </div>
      {open && r.calc_notes && (
        <pre className="mt-2 whitespace-pre-wrap rounded-lg border border-slate-200 bg-white p-2.5 text-xs text-slate-600">
          {r.calc_notes}
        </pre>
      )}
    </div>
  )
}
