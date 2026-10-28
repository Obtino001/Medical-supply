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
    exact: ['blue', 'Exact match'],
    high: ['blue', 'High confidence'],
    manual: ['blue', 'Confirmed by user'],
    needs_review: ['amber', 'Needs review'],
    unmatched: ['slate', 'Unmatched'],
    conflicting: ['red', 'Conflicting attributes'],
  } as const
  const [tone, label] = map[status]
  return <Badge tone={tone}>{label}</Badge>
}

export function FreshBadge({ ageDays, fresh }: { ageDays: number; fresh: boolean }) {
  return fresh ? <Badge tone="slate">Recent · {ageDays}d old</Badge> : <Badge tone="amber">Outdated · {ageDays}d old</Badge>
}

export function OfferCard({ o, shop, extra }: { o: OfferView; shop: Shop | undefined; extra?: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const r = o.rec
  const best = o.isBest
  const isSchemeOnly = !o.eligible && r.scheme_status === 'ok' && r.effective_cost == null && !!r.scheme_text
  return (
    <div
      className={cx(
        'rounded-lg border p-3.5 transition-colors',
        best
          ? 'border-[#188038] bg-[#E6F4EA]/50'
          : o.eligible || isSchemeOnly
            ? 'border-[#DADCE0] bg-[#F8F9FA]'
            : 'border-[#DADCE0] bg-[#F8F9FA] opacity-85',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-[#202124] sm:text-base">{shop?.name ?? 'Unknown shop'}</span>
            {best && <Badge tone="solid">{o.isTied ? 'BEST PRICE (TIED)' : 'BEST PRICE'}</Badge>}
          </div>
          <div className="mt-0.5 text-xs text-[#5F6368]">
            Price list date: <span className="font-medium text-[#202124] tabular-nums">{fmtDate(r.observed_on)}</span>
            {shop?.city ? ` · ${shop.city}` : ''}
          </div>
        </div>
        <div className="text-right">
          {o.eligible ? (
            <>
              <div className={cx('text-lg font-semibold tabular-nums sm:text-xl', best ? 'text-[#188038]' : 'text-[#202124]')}>
                {rs(o.cents! / 100)}
              </div>
              <div className="text-[11px] text-[#5F6368]">effective purchase price</div>
            </>
          ) : isSchemeOnly ? (
            <>
              <div className="text-base font-semibold text-[#1A73E8] sm:text-lg">{r.scheme_text}</div>
              <div className="text-[11px] text-[#5F6368]">trade price / discount offer</div>
            </>
          ) : (
            <>
              <div className="text-lg font-semibold text-[#202124] tabular-nums sm:text-xl">—</div>
              <div className="text-[11px] text-[#5F6368]">effective purchase price</div>
            </>
          )}
        </div>
      </div>

      <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-md border border-[#DADCE0] bg-white px-3 py-2 text-xs sm:grid-cols-4 sm:text-sm">
        <div>
          <span className="block text-[11px] text-[#5F6368]">Original offer rate</span>
          <b className="font-medium text-[#202124] tabular-nums">{r.base_price != null ? rs(r.base_price) : r.scheme_text || '—'}</b>
        </div>
        <div>
          <span className="block text-[11px] text-[#5F6368]">Discount / scheme</span>
          <b className="font-medium text-[#202124]">{r.scheme_text || 'None'}</b>
        </div>
        {r.pack_size != null && (
          <div>
            <span className="block text-[11px] text-[#5F6368]">Pack size</span>
            <b className="font-medium text-[#202124] tabular-nums">{r.pack_size}</b>
          </div>
        )}
        {o.perUnit && (
          <div>
            <span className="block text-[11px] text-[#5F6368]">{o.perUnit.label}</span>
            <b className="font-medium text-[#202124] tabular-nums">{rs(o.perUnit.value, 3)}</b>
          </div>
        )}
        {r.mrp != null && (
          <div>
            <span className="block text-[11px] text-[#5F6368]">MRP</span>
            <b className="font-medium text-[#202124] tabular-nums">{rs(r.mrp)}</b>
          </div>
        )}
        {r.availability && (
          <div>
            <span className="block text-[11px] text-[#5F6368]">Stock</span>
            <b className="font-medium text-[#202124]">{r.availability}</b>
          </div>
        )}
        {o.aboveBest != null && o.aboveBest > 0 && (
          <div className="col-span-2">
            <span className="block text-[11px] text-[#5F6368]">Difference vs best</span>
            <b className="font-medium text-[#202124] tabular-nums">+{rs(o.aboveBest)}</b>
          </div>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <FreshBadge ageDays={o.ageDays} fresh={o.fresh} />
        <MatchBadge status={r.match_status} />
        {isSchemeOnly ? (
          <Badge tone="blue">Trade price / discount offer</Badge>
        ) : (
          !o.eligible && o.reason && <Badge tone="amber">{REASON[o.reason]}</Badge>
        )}
        {r.scheme_status === 'review' && <Badge tone="amber">Calculation needs review</Badge>}
      </div>

      <div className="mt-1.5 text-xs text-[#5F6368]">
        Shop's item name: <span className="font-medium text-[#202124]">“{r.original_title}”</span>
        {r.original_code ? ` · code ${r.original_code}` : ''}
        {r.notes ? ` · note: ${r.notes}` : ''}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        {r.calc_notes && (
          <button type="button" className="text-xs font-medium text-[#1A73E8] hover:text-[#1557B0] hover:underline" onClick={() => setOpen(!open)}>
            {open ? 'Hide calculation steps' : 'Show calculation steps'}
          </button>
        )}
        {extra}
      </div>
      {open && r.calc_notes && (
        <pre className="mt-2 whitespace-pre-wrap rounded-md border border-[#DADCE0] bg-white p-2.5 text-xs text-[#5F6368]">
          {r.calc_notes}
        </pre>
      )}
    </div>
  )
}
