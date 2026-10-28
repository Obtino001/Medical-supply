import { Link } from 'react-router-dom'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { IconAlert, IconCheck, IconClose } from './icons'

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

export const rs = (n: number | null | undefined, digits = 2) =>
  n == null ? '—' : 'Rs ' + n.toLocaleString('en-PK', { minimumFractionDigits: digits, maximumFractionDigits: digits })

export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  small?: boolean
}

export function Button({ variant = 'primary', small, className, type = 'button', ...p }: BtnProps) {
  const v = {
    primary:
      'bg-[#1A73E8] text-white hover:bg-[#1557B0] active:bg-[#1557B0] focus-visible:outline-[#1A73E8] disabled:bg-[#1A73E8]/40 disabled:text-white/80',
    secondary:
      'bg-white text-[#202124] border border-[#DADCE0] hover:bg-[#F8F9FA] active:bg-[#E8F0FE]/60 focus-visible:outline-[#1A73E8] disabled:bg-[#F8F9FA] disabled:text-[#5F6368] disabled:border-[#DADCE0]',
    danger:
      'bg-[#D93025] text-white hover:bg-[#B3261E] active:bg-[#B3261E] focus-visible:outline-[#D93025] disabled:bg-[#D93025]/40',
    ghost:
      'text-[#1A73E8] hover:bg-[#E8F0FE] active:bg-[#E8F0FE]/80 focus-visible:outline-[#1A73E8] disabled:text-[#5F6368] disabled:hover:bg-transparent',
  }[variant]
  return (
    <button
      type={type}
      {...p}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors duration-150 select-none focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed',
        small ? 'min-h-8.5 px-3 py-1.5 text-xs sm:text-sm' : 'min-h-10 px-4 py-2 text-sm',
        v,
        className,
      )}
    />
  )
}

const inputCls =
  'w-full min-h-10 rounded-md border border-[#DADCE0] bg-white px-3 py-2 text-[#202124] transition-colors duration-150 placeholder:text-[#5F6368]/75 hover:border-[#5F6368] focus:border-[#1A73E8] focus:outline-none focus:ring-2 focus:ring-[#1A73E8]/20 disabled:cursor-not-allowed disabled:bg-[#F8F9FA] disabled:text-[#5F6368]'

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 block text-xs font-medium text-[#202124] sm:text-sm">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs leading-relaxed text-[#5F6368]">{hint}</span>}
    </label>
  )
}

export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(inputCls, p.className)} />
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(inputCls, p.className)} />
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx(inputCls, 'min-h-20 py-2.5', p.className)} />

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        'rounded-lg border border-[#DADCE0] bg-white p-4 sm:p-5',
        className,
      )}
    >
      {children}
    </div>
  )
}

const tones = {
  green: 'bg-[#E6F4EA] text-[#188038] border-[#CEEAD6]',
  teal: 'bg-[#E8F0FE] text-[#1A73E8] border-[#D2E3FC]',
  blue: 'bg-[#E8F0FE] text-[#1A73E8] border-[#D2E3FC]',
  amber: 'bg-[#FEF7E0] text-[#B06000] border-[#FDD663]',
  red: 'bg-[#FCE8E6] text-[#D93025] border-[#FAD2CF]',
  slate: 'bg-[#F8F9FA] text-[#5F6368] border-[#DADCE0]',
  solid: 'bg-[#188038] text-white border-[#188038]',
}

export function Badge({ tone = 'slate', children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        tones[tone],
      )}
    >
      {children}
    </span>
  )
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 p-10 text-sm font-medium text-[#5F6368]" role="status">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-[#1A73E8] border-t-transparent" />
      {label}
    </div>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-[#DADCE0] bg-white px-6 py-10 text-center">
      <div className="text-base font-medium text-[#202124]">{title}</div>
      {children && <div className="mx-auto mt-1.5 max-w-md text-sm text-[#5F6368]">{children}</div>}
    </div>
  )
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-md border border-[#FAD2CF] bg-[#FCE8E6] p-3.5 text-sm text-[#D93025]">
      <IconAlert size={18} className="mt-0.5 shrink-0 text-[#D93025]" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-medium tracking-tight text-[#202124] sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-[#5F6368]">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#202124]/45 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx(
          'max-h-[92vh] w-full overflow-y-auto rounded-t-xl border border-[#DADCE0] bg-white p-4 shadow-xl sm:rounded-xl sm:p-6',
          wide ? 'sm:max-w-3xl' : 'sm:max-w-lg',
        )}
      >
        <div className="mb-4 flex items-center justify-between gap-3 border-b border-[#DADCE0] pb-3">
          <h2 className="text-base font-medium text-[#202124] sm:text-lg">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#5F6368] transition-colors hover:bg-[#F8F9FA] hover:text-[#202124]"
          >
            <IconClose size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ---- toasts
type Toast = { id: number; kind: 'ok' | 'err'; text: string }
const ToastCtx = createContext<(kind: 'ok' | 'err', text: string) => void>(() => {})
export const useToast = () => useContext(ToastCtx)

// ---- confirm dialogs
type ConfirmOpts = { title: string; body?: ReactNode; confirmLabel?: string; danger?: boolean }
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false)
export const useConfirm = () => useContext(ConfirmCtx)

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)
  const push = useCallback((kind: 'ok' | 'err', text: string) => {
    const id = nextId.current++
    setToasts((t) => [...t, { id, kind, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 8000 : 3500)
  }, [])
  const [confirm, setConfirm] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null)
  const ask = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setConfirm({ ...o, resolve })), [])
  const close = (v: boolean) => { confirm?.resolve(v); setConfirm(null) }
  return (
    <ToastCtx.Provider value={push}>
      <ConfirmCtx.Provider value={ask}>
        {children}
        <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-3">
          {toasts.map((t) => (
            <div
              key={t.id}
              role="status"
              className={cx(
                'pointer-events-auto flex max-w-md items-center gap-2 rounded-md border px-4 py-2.5 text-sm font-medium shadow-md',
                t.kind === 'ok'
                  ? 'border-[#188038] bg-[#188038] text-white'
                  : 'border-[#D93025] bg-[#D93025] text-white',
              )}
            >
              {t.kind === 'ok' ? <IconCheck size={16} /> : <IconAlert size={16} />}
              <span>{t.text}</span>
            </div>
          ))}
        </div>
        <Modal open={!!confirm} onClose={() => close(false)} title={confirm?.title ?? ''}>
          <div className="text-sm leading-relaxed text-[#5F6368]">{confirm?.body}</div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => close(false)}>Cancel</Button>
            <Button variant={confirm?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>{confirm?.confirmLabel ?? 'Confirm'}</Button>
          </div>
        </Modal>
      </ConfirmCtx.Provider>
    </ToastCtx.Provider>
  )
}

export function Pagination({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null
  return (
    <div className="mt-4 flex items-center justify-between gap-2 rounded-lg border border-[#DADCE0] bg-white px-3 py-2">
      <Button variant="secondary" small disabled={page <= 0} onClick={() => onPage(page - 1)}>← Previous</Button>
      <span className="text-xs font-medium text-[#5F6368] sm:text-sm tabular-nums">Page {page + 1} of {pages}</span>
      <Button variant="secondary" small disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>Next →</Button>
    </div>
  )
}

export function Stat({
  label,
  value,
  to,
  tone,
  icon,
}: {
  label: string
  value: ReactNode
  to?: string
  tone?: 'amber' | 'green' | 'teal' | 'blue'
  icon?: ReactNode
}) {
  const toneCls =
    tone === 'amber'
      ? 'border-[#FDD663] bg-[#FEF7E0]/60'
      : tone === 'green'
        ? 'border-[#CEEAD6] bg-[#E6F4EA]/50'
        : tone === 'teal' || tone === 'blue'
          ? 'border-[#1A73E8] bg-[#E8F0FE]/60'
          : 'border-[#DADCE0] bg-white'
  const inner = (
    <div
      className={cx(
        'flex h-full flex-col justify-between rounded-lg border p-3.5 transition-colors duration-150',
        toneCls,
        to && 'hover:border-[#1A73E8] hover:bg-[#F8F9FA]',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-[#5F6368]">{label}</span>
        {icon && (
          <span
            className={cx(
              'text-[#1A73E8]',
              tone === 'amber' && 'text-[#B06000]',
              tone === 'green' && 'text-[#188038]',
            )}
          >
            {icon}
          </span>
        )}
      </div>
      <div
        className={cx(
          'mt-1.5 text-2xl font-medium tracking-tight tabular-nums',
          tone === 'amber' ? 'text-[#B06000]' : tone === 'green' ? 'text-[#188038]' : 'text-[#202124]',
        )}
      >
        {value}
      </div>
    </div>
  )
  return to ? <Link to={to} className="block h-full">{inner}</Link> : inner
}

/** Debounced value hook for search boxes. */
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** Per-viewer convenience storage (never the source of truth). */
export function useLocalState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : initial
    } catch { return initial }
  })
  const set = (x: T) => {
    setV(x)
    try { localStorage.setItem(key, JSON.stringify(x)) } catch { /* private mode */ }
  }
  return [v, set]
}
