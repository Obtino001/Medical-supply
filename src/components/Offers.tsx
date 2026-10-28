import { useState } from 'react'
import type { OfferView } from '../lib/compare'
import type { PriceRecord, Shop } from '../lib/types'
import { Badge, cx, fmtDate, rs } from './ui'

const REASON: Record<string, string> = {
  review: 'Needs review: not ranked',
  invalid: 'Invalid or missing price: not ranked',
  unavailable: 'Out of stock / unavailable: not ranked',
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
  return fresh ? <Badge tone="slate">Fresh · {ageDays}d</Badge> : <Badge tone="amber">Stale · {ageDays}d</Badge>
}

/**
 * Compact, mobile-first supplier offer row used when expanding a product in Compare Prices,
 * Wishlist, or Best Opportunities. Ordered from cheapest to most expensive.
 */
export function OfferRow({
  o,
  rank,
  isWinner,
  shop,
  extra,
}: {
  o: OfferView
  rank?: number
  isWinner?: boolean
  shop: Shop | undefined
  extra?: React.ReactNode
}) {
  const [showCalc, setShowCalc] = useState(false)
  const r = o.rec
  const win = Boolean(isWinner ?? o.isBest)
  const isSchemeOnly = o.isDiscountOnly

  return (
    <div
      className={cx(
        'rounded-lg border px-3 py-2 text-xs transition-colors',
        win
          ? 'border-[var(--color-best-border)] border-l-4 border-l-[var(--color-best-solid)] bg-[var(--color-best-bg)]'
          : o.eligible || isSchemeOnly
            ? 'border-[var(--border-default)] bg-[var(--bg-surface)]'
            : 'border-[var(--border-default)] bg-[var(--bg-surface)] opacity-80',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {rank != null && o.eligible && (
              <span
                className={cx(
                  'inline-flex h-4.5 min-w-4.5 items-center justify-center rounded px-1 text-[10px] font-semibold tabular-nums',
                  win
                    ? 'bg-[var(--color-best-solid)] text-[var(--color-best-solid-text)]'
                    : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]',
                )}
              >
                #{rank}
              </span>
            )}
            <span className={cx('truncate text-xs sm:text-[13px] font-semibold', win ? 'text-[var(--text-primary)]' : 'text-[var(--text-primary)]')}>
              {shop?.name ?? 'Unknown supplier'}
            </span>
            {win && (
              <Badge tone="solid">
                {o.isTied ? 'BEST PRICE (TIED)' : 'BEST PRICE'}
              </Badge>
            )}
            {!o.fresh && <Badge tone="amber">Stale · {o.ageDays}d</Badge>}
            {o.reason === 'expired' && <Badge tone="red">Expired</Badge>}
            {isSchemeOnly && <Badge tone="amber">Incomplete · base rate missing</Badge>}
            {!isSchemeOnly && !o.eligible && o.reason && o.reason !== 'expired' && (
              <Badge tone="amber">{REASON[o.reason]}</Badge>
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-[var(--text-secondary)]">
            {r.base_price != null && (
              <span className="tabular-nums">
                Rate: <b className="font-medium text-[var(--text-primary)]">{rs(r.base_price)}</b>
              </span>
            )}
            {r.scheme_text && (
              <span>
                Scheme: <b className="font-medium text-[var(--text-primary)]">{r.scheme_text}</b>
              </span>
            )}
            {o.perUnit && (
              <span className="tabular-nums">
                ({rs(o.perUnit.value, 2)}/{o.perUnit.label.replace('per ', '')})
              </span>
            )}
            <span className="tabular-nums">
              Surveyed <b className="font-medium text-[var(--text-primary)]">{fmtDate(r.observed_on)}</b>
            </span>
            {r.valid_until && (
              <span className="tabular-nums">· Valid until {fmtDate(r.valid_until)}</span>
            )}
            {r.expiry && <span className="tabular-nums">· Exp {r.expiry}</span>}
          </div>
        </div>

        <div className="shrink-0 text-right">
          {o.eligible ? (
            <>
              <div
                className={cx(
                  'text-sm sm:text-[15px] font-bold tabular-nums',
                  win ? 'text-[var(--color-best)]' : 'text-[var(--text-primary)]',
                )}
              >
                {rs(o.cents! / 100)}
              </div>
              {o.aboveBest != null && o.aboveBest > 0 ? (
                <div className="text-[11px] font-medium text-[var(--color-error-text)] tabular-nums">
                  +{rs(o.aboveBest)} vs best
                </div>
              ) : (
                <div className="text-[10.5px] font-medium text-[var(--color-best)]">
                  Lowest effective cost
                </div>
              )}
            </>
          ) : isSchemeOnly ? (
            <>
              <div className="text-xs sm:text-[13px] font-semibold text-[var(--color-primary)]">
                {r.scheme_text}
              </div>
              <div className="text-[10.5px] text-[var(--text-secondary)]">
                No Rs rate to compare
              </div>
            </>
          ) : (
            <>
              <div className="text-sm font-semibold text-[var(--text-secondary)] tabular-nums">—</div>
              <div className="text-[10.5px] text-[var(--text-secondary)]">Not eligible</div>
            </>
          )}
        </div>
      </div>

      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-default)]/50 pt-1 text-[11px] text-[var(--text-secondary)]">
        <span className="min-w-0 truncate" title={r.original_title}>
          List item: <span className="text-[var(--text-primary)]">“{r.original_title}”</span>
          {r.original_code ? ` · code ${r.original_code}` : ''}
          {r.notes ? ` · ${r.notes}` : ''}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {r.calc_notes && (
            <button
              type="button"
              className="font-medium text-[var(--color-primary)] hover:underline"
              onClick={() => setShowCalc(!showCalc)}
            >
              {showCalc ? 'Hide calc' : 'Calc details'}
            </button>
          )}
          {extra}
        </span>
      </div>

      {showCalc && r.calc_notes && (
        <pre className="mt-1.5 whitespace-pre-wrap rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] p-2 text-[11px] text-[var(--text-secondary)]">
          {r.calc_notes}
        </pre>
      )}
    </div>
  )
}

export function OfferCard({ o, shop, extra }: { o: OfferView; shop: Shop | undefined; extra?: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const r = o.rec
  const best = o.isBest
  const isSchemeOnly = o.isDiscountOnly
  return (
    <div
      className={cx(
        'rounded-xl border p-3 transition-colors',
        best
          ? 'border-[var(--color-best-border)] border-l-4 border-l-[var(--color-best-solid)] bg-[var(--color-best-bg)]'
          : o.eligible || isSchemeOnly
            ? 'border-[var(--border-default)] bg-[var(--bg-surface)]'
            : 'border-[var(--border-default)] bg-[var(--bg-surface)] opacity-85',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-medium text-[var(--text-primary)]">{shop?.name ?? 'Unknown shop'}</span>
            {best && <Badge tone="solid">{o.isTied ? 'BEST PRICE (TIED)' : 'BEST PRICE'}</Badge>}
          </div>
          <div className="mt-0.5 text-xs text-[var(--text-secondary)]">
            Survey date: <span className="font-medium text-[var(--text-primary)] tabular-nums">{fmtDate(r.observed_on)}</span>
            {shop?.city ? ` · ${shop.city}` : ''}
          </div>
        </div>
        <div className="shrink-0 text-right">
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
              <div className="text-[11px] text-[var(--text-secondary)]">discount / scheme only (no Rs rate)</div>
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
          <Badge tone="amber">Incomplete: base rate missing</Badge>
        ) : (
          !o.eligible && o.reason && <Badge tone="amber">{REASON[o.reason]}</Badge>
        )}
        {r.scheme_status === 'review' && <Badge tone="amber">Calculation needs review</Badge>}
      </div>

      <div className="mt-1.5 truncate text-xs text-[var(--text-secondary)]" title={r.original_title}>
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
