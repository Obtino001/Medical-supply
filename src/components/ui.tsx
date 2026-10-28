import { Link } from 'react-router-dom'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

export const rs = (n: number | null | undefined, digits = 2) =>
  n == null ? '—' : 'Rs ' + n.toLocaleString('en-PK', { minimumFractionDigits: digits, maximumFractionDigits: digits })

export const fmtDate = (d: string | null | undefined) => (d ? new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; small?: boolean }
export function Button({ variant = 'primary', small, className, ...p }: BtnProps) {
  const v = {
    primary: 'bg-emerald-700 text-white hover:bg-emerald-800 disabled:bg-emerald-300',
    secondary: 'bg-white text-slate-800 border border-slate-300 hover:bg-slate-100 disabled:text-slate-400',
    danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
    ghost: 'text-emerald-800 hover:bg-emerald-50 disabled:text-slate-400',
  }[variant]
  return <button {...p} className={cx('rounded-lg font-semibold inline-flex items-center justify-center gap-1.5 select-none disabled:cursor-not-allowed', small ? 'min-h-9 px-3 text-sm' : 'min-h-11 px-4', v, className)} />
}

const inputCls = 'w-full min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder:text-slate-400 focus:outline-2 focus:outline-emerald-600'

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(inputCls, p.className)} />
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(inputCls, p.className)} />
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx(inputCls, 'min-h-20', p.className)} />

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-xl border border-slate-200 bg-white p-4 shadow-sm', className)}>{children}</div>
}

const tones = {
  green: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  amber: 'bg-amber-100 text-amber-900 border-amber-300',
  red: 'bg-red-100 text-red-900 border-red-300',
  slate: 'bg-slate-100 text-slate-700 border-slate-300',
  blue: 'bg-sky-100 text-sky-900 border-sky-300',
  solid: 'bg-emerald-700 text-white border-emerald-800',
}
export function Badge({ tone = 'slate', children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return <span className={cx('inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold whitespace-nowrap', tones[tone])}>{children}</span>
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 p-8 text-slate-600" role="status">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-emerald-700 border-t-transparent" />
      {label}
    </div>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <div className="font-semibold text-slate-800">{title}</div>
      {children && <div className="mt-2 text-sm text-slate-600">{children}</div>}
    </div>
  )
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">{children}</div>
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-xl font-bold sm:text-2xl">{title}</h1>
      <div className="flex flex-wrap gap-2">{children}</div>
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={cx('max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="min-h-9 min-w-9 rounded-lg text-2xl leading-none text-slate-500 hover:bg-slate-100">×</button>
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
        <div className="pointer-events-none fixed inset-x-0 top-2 z-[60] flex flex-col items-center gap-2 px-3">
          {toasts.map((t) => (
            <div key={t.id} role="status" className={cx('pointer-events-auto max-w-md rounded-lg px-4 py-3 text-sm font-medium shadow-lg', t.kind === 'ok' ? 'bg-emerald-700 text-white' : 'bg-red-700 text-white')}>{t.text}</div>
          ))}
        </div>
        <Modal open={!!confirm} onClose={() => close(false)} title={confirm?.title ?? ''}>
          <div className="text-slate-700">{confirm?.body}</div>
          <div className="mt-4 flex justify-end gap-2">
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
    <div className="mt-3 flex items-center justify-between gap-2">
      <Button variant="secondary" small disabled={page <= 0} onClick={() => onPage(page - 1)}>← Prev</Button>
      <span className="text-sm text-slate-600">Page {page + 1} of {pages}</span>
      <Button variant="secondary" small disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>Next →</Button>
    </div>
  )
}

export function Stat({ label, value, to, tone }: { label: string; value: ReactNode; to?: string; tone?: 'amber' }) {
  const inner = (
    <div className={cx('rounded-xl border bg-white p-3 shadow-sm', tone === 'amber' ? 'border-amber-300' : 'border-slate-200')}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs font-medium text-slate-600">{label}</div>
    </div>
  )
  return to ? <Link to={to}>{inner}</Link> : inner
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
