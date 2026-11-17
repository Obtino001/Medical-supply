import { useMemo, useState } from 'react'
import { bulkAssignCompany } from '../lib/actions'
import { PHARMA_COMPANIES, findKnownCompany, resolveCanonicalCompany } from '../lib/companies'
import { useData } from '../lib/data'
import { IconBuilding, IconCheck, IconSearch } from './icons'
import { Badge, Button, ErrorBox, Input, Modal, cx, useToast } from './ui'

export function AssignCompanyModal({
  open,
  onClose,
  productIds,
  title,
  initialCompany = '',
  onAssigned,
}: {
  open: boolean
  onClose: () => void
  productIds: string[]
  title?: string
  initialCompany?: string
  onAssigned?: (company: string | null) => void
}) {
  const { products, reload } = useData()
  const toast = useToast()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string>(initialCompany)
  const [customName, setCustomName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const companyOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of products) {
      if (p.archived) continue
      const c = resolveCanonicalCompany(p.manufacturer)
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1)
    }

    const seen = new Set<string>()
    const list: { name: string; shortName: string; top50Rank: number | null; count: number; aliases: string[] }[] = []

    for (const c of PHARMA_COMPANIES) {
      seen.add(c.name)
      list.push({
        name: c.name,
        shortName: c.shortName,
        top50Rank: c.top50Rank,
        count: counts.get(c.name) ?? 0,
        aliases: c.aliases,
      })
    }

    for (const [name, count] of counts.entries()) {
      if (seen.has(name)) continue
      const known = findKnownCompany(name)
      if (known) continue
      list.push({ name, shortName: name, top50Rank: null, count, aliases: [] })
    }

    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.shortName.toLowerCase().includes(q) ||
        (c.top50Rank != null && `#${c.top50Rank}` === q) ||
        c.aliases.some((a) => a.includes(q)),
    )
  }, [products, search])

  const targetCompany = customName.trim() ? resolveCanonicalCompany(customName.trim()) ?? customName.trim() : selected || null

  const apply = async (companyValue: string | null) => {
    if (productIds.length === 0) return
    setBusy(true)
    setErr(null)
    try {
      const updated = await bulkAssignCompany(productIds.map((productId) => ({ productId, manufacturer: companyValue })))
      await reload()
      toast(
        'ok',
        companyValue
          ? `Assigned ${updated} product${updated === 1 ? '' : 's'} to ${companyValue}`
          : `Cleared company on ${updated} product${updated === 1 ? '' : 's'}`,
      )
      onAssigned?.(companyValue)
      onClose()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title ?? `Assign ${productIds.length} product${productIds.length === 1 ? '' : 's'} to a company`}
      wide
    >
      <div className="space-y-3.5">
        <div className="relative">
          <IconSearch size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--text-secondary)]" />
          <Input
            type="search"
            placeholder="Search Top 50 Pakistan Pharma or other company (e.g. Getz, GSK, CCL, Sami)…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            autoFocus
          />
        </div>

        <div className="max-h-72 overflow-y-auto rounded-xl border border-[var(--border-default)] bg-[var(--bg-subtle)] p-2">
          {companyOptions.length === 0 ? (
            <div className="p-4 text-center text-xs text-[var(--text-secondary)]">
              No matching company in the directory. Enter a custom name below.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {companyOptions.map((c) => {
                const isActive = !customName.trim() && selected === c.name
                return (
                  <button
                    key={c.name}
                    type="button"
                    onClick={() => {
                      setSelected(c.name)
                      setCustomName('')
                    }}
                    className={cx(
                      'flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors',
                      isActive
                        ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] text-[var(--color-primary)]'
                        : 'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]',
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      {c.top50Rank != null ? (
                        <span className="shrink-0 rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-secondary)] tabular-nums">
                          #{c.top50Rank}
                        </span>
                      ) : (
                        <IconBuilding size={13} className="shrink-0 text-[var(--text-secondary)]" />
                      )}
                      <span className="truncate font-medium">{c.name}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span className="text-[11px] text-[var(--text-secondary)] tabular-nums">{c.count}</span>
                      {isActive && <IconCheck size={14} className="text-[var(--color-primary)]" />}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-3">
          <div className="text-xs font-medium text-[var(--text-primary)]">Or enter a custom company name</div>
          <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              placeholder="Type custom pharma / distributor company name…"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
            />
            {selected && (
              <Badge tone="blue">Selected: {targetCompany}</Badge>
            )}
          </div>
        </div>

        {err && <ErrorBox>{err}</ErrorBox>}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-default)] pt-3">
          <Button
            variant="ghost"
            small
            disabled={busy}
            onClick={() => void apply(null)}
            title="Move selected product(s) to Uncategorized"
          >
            Clear company (Uncategorized)
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button disabled={busy || !targetCompany} onClick={() => void apply(targetCompany)}>
              {busy ? 'Saving…' : targetCompany ? `Assign to ${targetCompany}` : 'Select a company'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
