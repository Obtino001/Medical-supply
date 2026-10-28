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
        'rounded-xl border p-3 transition-colors',
        best
          ? 'border-[var(--color-best-border)] bg-[var(--color-best-bg)]'
          : o.eligible || isSchemeOnly
            ? 'border-[var(--border-default)] bg-[var(--bg-surface)]'
            : 'border-[var(--border-default)] bg-[var(--bg-surface)] opacity-85',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium text-[var(--text-primary)]">{shop?.name ?? 'Unknown shop'}</span>
            {best && <Badge tone="solid">{o.isTied ? 'BEST PRICE (TIED)' : 'BEST PRICE'}</Badge>}
          </div>
          <div className="mt-0.5 text-xs text-[var(--text-secondary)]">
            Survey date: <span className="font-medium text-[var(--text-primary)] tabular-nums">{fmtDate(r.observed_on)}</span>
            {shop?.city ? ` · ${shop.city}` : ''}
          </div>
        </div>
        <div className="text-right">
          {o.eligible ? (
            <>
              <div className={cx('text-base font-semibold tabular-nums sm:text-lg', best ? 'text-[var(--color-best)]' : 'text-[var(--text-primary)]')}>
                {rs(o.cents! / 100)}
              </div>
              <div className="text-[11px] text-[var(--text-secondary)]">effective purchase price</div>
            </>
          ) : isSchemeOnly ? (
            <>
              <div className="text-sm font-semibold text-[var(--color-primary)] sm:text-base">{r.scheme_text}</div>
              <div className="text-[11px] text-[var(--text-secondary)]">trade price / discount offer</div>
            </>
          ) : (
            <>
              <div className="text-base font-semibold text-[var(--text-primary)] tabular-nums sm:text-lg">—</div>
              <div className="text-[11px] text-[var(--text-secondary)]">effective purchase price</div>
            </>
          )}
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-subtle)] px-2.5 py-1.5 text-xs sm:grid-cols-4">
        <div>
          <span className="block text-[11px] text-[var(--text-secondary)]">Original offer rate</span>
          <b className="font-medium text-[var(--text-primary)] tabular-nums">{r.base_price != null ? rs(r.base_price) : r.scheme_text || '—'}</b>
        </div>
        <div>
          <span className="block text-[11px] text-[var(--text-secondary)]">Discount / scheme</span>
          <b className="font-medium text-[var(--text-primary)]">{r.scheme_text || 'None'}</b>
        </div>
        {r.pack_size != null && (
          <div>
            <span className="block text-[11px] text-[var(--text-secondary)]">Pack size</span>
            <b className="font-medium text-[var(--text-primary)] tabular-nums">{r.pack_size}</b>
          </div>
        )}
        {o.perUnit && (
          <div>
            <span className="block text-[11px] text-[var(--text-secondary)]">{o.perUnit.label}</span>
            <b className="font-medium text-[var(--text-primary)] tabular-nums">{rs(o.perUnit.value, 3)}</b>
          </div>
        )}
        {r.mrp != null && (
          <div>
            <span className="block text-[11px] text-[var(--text-secondary)]">MRP</span>
            <b className="font-medium text-[var(--text-primary)] tabular-nums">{rs(r.mrp)}</b>
          </div>
        )}
        {r.availability && (
          <div>
            <span className="block text-[11px] text-[var(--text-secondary)]">Stock</span>
            <b className="font-medium text-[var(--text-primary)]">{r.availability}</b>
          </div>
        )}
        {o.aboveBest != null && o.aboveBest > 0 && (
          <div className="col-span-2">
            <span className="block text-[11px] text-[var(--text-secondary)]">Difference vs best</span>
            <b className="font-medium text-[var(--text-primary)] tabular-nums">+{rs(o.aboveBest)}</b>
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <FreshBadge ageDays={o.ageDays} fresh={o.fresh} />
        <MatchBadge status={r.match_status} />
        {isSchemeOnly ? (
          <Badge tone="blue">Trade price / discount offer</Badge>
        ) : (
          !o.eligible && o.reason && <Badge tone="amber">{REASON[o.reason]}</Badge>
        )}
        {r.scheme_status === 'review' && <Badge tone="amber">Calculation needs review</Badge>}
      </div>

      <div className="mt-1.5 text-xs text-[var(--text-secondary)]">
        Shop's item name: <span className="font-medium text-[var(--text-primary)]">“{r.original_title}”</span>
        {r.original_code ? ` · code ${r.original_code}` : ''}
        {r.notes ? ` · note: ${r.notes}` : ''}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-3">
        {r.calc_notes && (
          <button type="button" className="text-xs font-medium text-[var(--color-primary)] hover:underline" onClick={() => setOpen(!open)}>
            {open ? 'Hide calculation steps' : 'Show calculation steps'}
          </button>
        )}
        {extra}
      </div>
      {open && r.calc_notes && (
        <pre className="mt-2 whitespace-pre-wrap rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-2.5 text-xs text-[var(--text-secondary)]">
          {r.calc_notes}
        </pre>
      )}
    </div>
  )
}
