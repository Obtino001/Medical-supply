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
      'bg-teal-700 text-white shadow-xs hover:bg-teal-800 active:bg-teal-900 focus-visible:outline-teal-700 disabled:bg-teal-700/40 disabled:text-white/80',
    secondary:
      'bg-white text-slate-700 border border-slate-300 shadow-2xs hover:bg-slate-50 hover:border-slate-400 active:bg-slate-100 focus-visible:outline-teal-700 disabled:bg-slate-50 disabled:text-slate-400 disabled:border-slate-200',
    danger:
      'bg-red-600 text-white shadow-xs hover:bg-red-700 active:bg-red-800 focus-visible:outline-red-600 disabled:bg-red-300',
    ghost:
      'text-teal-800 hover:bg-teal-50/80 active:bg-teal-100/70 focus-visible:outline-teal-700 disabled:text-slate-400 disabled:hover:bg-transparent',
  }[variant]
  return (
    <button
      type={type}
      {...p}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all duration-150 select-none focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed',
        small ? 'min-h-8.5 px-3 py-1.5 text-xs sm:text-sm' : 'min-h-10 px-4 py-2 text-sm',
        v,
        className,
      )}
    />
  )
}

const inputCls =
  'w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-2xs transition-colors duration-150 placeholder:text-slate-400 hover:border-slate-400 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500'

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 block text-xs font-medium tracking-wide text-slate-700 sm:text-sm">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs leading-relaxed text-slate-500">{hint}</span>}
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
        'rounded-xl border border-slate-200/90 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-5',
        className,
      )}
    >
      {children}
    </div>
  )
}

const tones = {
  green: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  teal: 'bg-teal-50 text-teal-800 border-teal-200',
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
  red: 'bg-red-50 text-red-800 border-red-200',
  slate: 'bg-slate-100 text-slate-700 border-slate-200',
  blue: 'bg-sky-50 text-sky-800 border-sky-200',
  solid: 'bg-emerald-600 text-white border-emerald-700 shadow-2xs',
}

export function Badge({ tone = 'slate', children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        tones[tone],
      )}
    >
      {children}
    </span>
  )
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 p-10 text-sm font-medium text-slate-600" role="status">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-teal-700 border-t-transparent" />
      {label}
    </div>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <div className="text-base font-semibold text-slate-800">{title}</div>
      {children && <div className="mx-auto mt-1.5 max-w-md text-sm text-slate-500">{children}</div>}
    </div>
  )
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm text-red-900">
      <IconAlert size={18} className="mt-0.5 shrink-0 text-red-600" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-600">{subtitle}</p>}
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
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/45 p-0 backdrop-blur-[1px] sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx(
          'max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-4 shadow-xl sm:rounded-2xl sm:p-6',
          wide ? 'sm:max-w-3xl' : 'sm:max-w-lg',
        )}
      >
        <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <h2 className="text-base font-semibold text-slate-900 sm:text-lg">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
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
                'pointer-events-auto flex max-w-md items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium shadow-lg',
                t.kind === 'ok'
                  ? 'border-teal-800 bg-teal-800 text-white'
                  : 'border-red-700 bg-red-700 text-white',
              )}
            >
              {t.kind === 'ok' ? <IconCheck size={16} /> : <IconAlert size={16} />}
              <span>{t.text}</span>
            </div>
          ))}
        </div>
        <Modal open={!!confirm} onClose={() => close(false)} title={confirm?.title ?? ''}>
          <div className="text-sm leading-relaxed text-slate-600">{confirm?.body}</div>
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
    <div className="mt-4 flex items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-white px-3 py-2">
      <Button variant="secondary" small disabled={page <= 0} onClick={() => onPage(page - 1)}>← Previous</Button>
      <span className="text-xs font-medium text-slate-600 sm:text-sm tabular-nums">Page {page + 1} of {pages}</span>
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
  tone?: 'amber' | 'green' | 'teal'
  icon?: ReactNode
}) {
  const toneCls =
    tone === 'amber'
      ? 'border-amber-300 bg-amber-50/40'
      : tone === 'green'
        ? 'border-emerald-200 bg-emerald-50/30'
        : 'border-slate-200/90 bg-white'
  const inner = (
    <div
      className={cx(
        'flex h-full flex-col justify-between rounded-xl border p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all duration-150',
        toneCls,
        to && 'hover:border-teal-600/60 hover:shadow-sm',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        {icon && <span className={cx('text-slate-400', tone === 'amber' && 'text-amber-600', tone === 'green' && 'text-emerald-600')}>{icon}</span>}
      </div>
      <div className={cx('mt-1.5 text-2xl font-semibold tracking-tight tabular-nums', tone === 'amber' ? 'text-amber-900' : 'text-slate-900')}>
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
