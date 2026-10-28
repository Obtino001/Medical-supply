import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FreshBadge } from '../components/Offers'
import { WishlistToggle } from '../components/WishlistToggle'
import { Badge, Card, Empty, PageHeader, Pagination, Select, fmtDate, rs, useLocalState, useToast } from '../components/ui'
import { findOpportunities, type OpportunityReason } from '../lib/compare'
import { useData } from '../lib/data'
import { variantLabel } from '../lib/productParse'
import { supabase } from '../lib/supabase'
import type { OpportunityStatus } from '../lib/types'

const LABEL: Record<OpportunityReason, string> = { multiple: 'Several comparable offers', new_low: 'New lowest price', price_drop: 'Price dropped', scheme: 'Useful scheme' }
const STATUS: Record<OpportunityStatus['status'], string> = { interesting: 'Interesting', verify: 'Need to verify', contact: 'Contact supplier', purchased: 'Purchased (research note only)', not_interested: 'Not interested' }

export default function Opportunities() {
  const { products, current, history, settings, shopMap, opportunityStatus, reload } = useData()
  const toast = useToast()
  const [sort, setSort] = useLocalState<'pct' | 'abs'>('opp:sort', 'pct')
  const [reason, setReason] = useState<'' | OpportunityReason>('')
  const [verifiedOnly, setVerifiedOnly] = useState(true)
  const [hideStatus, setHideStatus] = useState(true)
  const [page, setPage] = useState(0)

  const all = useMemo(() => findOpportunities(products, current, history, { freshnessDays: settings.freshness_days, excludeStale: false }), [products, current, history, settings])
  const list = useMemo(() => {
    const out = all.filter((o) => (!verifiedOnly || o.verified) && (!reason || o.reasons.includes(reason)) && (!hideStatus || !['not_interested', 'purchased'].includes(opportunityStatus.get(o.product.id)?.status ?? '')))
    return out.sort((a, b) => (sort === 'pct' ? b.savingPct - a.savingPct : b.saving - a.saving))
  }, [all, verifiedOnly, reason, hideStatus, sort, opportunityStatus])

  const setStatus = async (productId: string, status: string) => {
    const { error } = status
      ? await supabase.from('opportunity_status').upsert({ product_id: productId, status }, { onConflict: 'workspace_id,product_id' })
      : await supabase.from('opportunity_status').delete().eq('product_id', productId)
    if (error) return toast('err', error.message)
    await reload()
  }
  const per = 20
  return (
    <div className="space-y-4">
      <PageHeader
        title="Best opportunities"
        subtitle="Savings are measured against the next-best comparable offer for the exact same variant across suppliers."
      />
      <Card className="!p-3.5">
        <div className="flex flex-wrap items-center gap-3">
          <Select className="!w-auto" value={sort} onChange={(e) => setSort(e.target.value as 'pct' | 'abs')}><option value="pct">Greatest % saving</option><option value="abs">Greatest Rs saving</option></Select>
          <Select className="!w-auto" value={reason} onChange={(e) => setReason(e.target.value as '')}><option value="">All reasons</option>{Object.entries(LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          <label className="flex min-h-9 items-center gap-2 text-xs font-medium text-slate-700"><input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} />Verified matches only</label>
          <label className="flex min-h-9 items-center gap-2 text-xs font-medium text-slate-700"><input type="checkbox" checked={hideStatus} onChange={(e) => setHideStatus(e.target.checked)} />Hide purchased / not interested</label>
        </div>
      </Card>
      {list.length === 0 ? <Empty title="No opportunities yet">Opportunities appear when at least two shops offer the same variant at valid prices.</Empty> : (
        <div className="space-y-2.5">
          {list.slice(page * per, page * per + per).map((o) => {
            const st = opportunityStatus.get(o.product.id)
            return (
              <Card key={o.product.id} className="border-[#DADCE0] transition-colors hover:border-[#1A73E8]">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to={`/products/${o.product.id}`} className="text-[15px] font-medium text-[#202124] hover:text-[#1A73E8] hover:underline">{o.product.name}</Link>
                      <span className="text-xs text-[#5F6368] tabular-nums">#{o.product.product_no}</span>
                      {variantLabel(o.product) && <Badge tone="blue">{variantLabel(o.product)}</Badge>}
                    </div>
                  </div>
                  <div className="text-right tabular-nums">
                    <div className="text-lg font-semibold text-[#188038]">Save {rs(o.saving)} <span className="text-sm font-medium">({o.savingPct.toFixed(1)}%)</span></div>
                    <div className="text-[11px] text-[#5F6368]">vs next-best supplier</div>
                  </div>
                </div>
                <div className="mt-2.5 grid gap-2 text-sm sm:grid-cols-2">
                  <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-[#CEEAD6] bg-[#E6F4EA] px-3 py-2 text-xs">
                    <Badge tone="solid">{o.tied ? 'BEST PRICE (TIED)' : 'BEST PRICE'}</Badge>
                    <b className="font-medium text-[#202124]">{shopMap.get(o.best.rec.shop_id)?.name}</b>:
                    <b className="font-semibold text-[#188038] tabular-nums">{rs(o.best.cents! / 100)}</b>
                    {o.best.rec.scheme_text ? <span className="text-[#5F6368]">({o.best.rec.scheme_text})</span> : ''}
                  </div>
                  {o.next && (
                    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-[#DADCE0] bg-[#F8F9FA] px-3 py-2 text-xs text-[#5F6368]">
                      <span>Next best:</span>
                      <b className="font-medium text-[#202124]">{shopMap.get(o.next.rec.shop_id)?.name}</b>:
                      <span className="font-medium tabular-nums">{rs(o.next.cents! / 100)}</span>
                    </div>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {o.reasons.map((r) => <Badge key={r} tone={r === 'multiple' ? 'slate' : 'green'}>{LABEL[r]}{r === 'price_drop' && o.dropPct ? ` ${o.dropPct.toFixed(0)}%` : ''}{r === 'new_low' && o.priorLow ? ` (was ${rs(o.priorLow)})` : ''}</Badge>)}
                  <FreshBadge ageDays={o.best.ageDays} fresh={o.best.fresh} />
                  <Badge tone={o.verified ? 'blue' : 'amber'}>Match: {o.confidence}</Badge>
                  <span className="text-xs text-[#5F6368]">Survey {fmtDate(o.best.rec.observed_on)}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Select className="!w-auto !min-h-9 text-sm" value={st?.status ?? ''} onChange={(e) => void setStatus(o.product.id, e.target.value)} aria-label="Opportunity status">
                    <option value="">Status: none</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                  <WishlistToggle productId={o.product.id} />
                </div>
              </Card>
            )
          })}
        </div>
      )}
      <Pagination page={page} pages={Math.ceil(list.length / per)} onPage={setPage} />
    </div>
  )
}
