import { useState } from 'react'
import { Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { Button, Spinner, UiProvider, cx } from './components/ui'
import { AuthProvider, useAuth } from './lib/auth'
import { DataProvider, useData } from './lib/data'
import { configured } from './lib/supabase'
import Compare from './pages/Compare'
import Dashboard from './pages/Dashboard'
import ExportCenter from './pages/ExportCenter'
import ImportHistory from './pages/ImportHistory'
import ImportWizard from './pages/ImportWizard'
import Login from './pages/Login'
import Opportunities from './pages/Opportunities'
import ProductDetail from './pages/ProductDetail'
import Products from './pages/Products'
import Review from './pages/Review'
import Settings from './pages/Settings'
import ShopDetail from './pages/ShopDetail'
import Shops from './pages/Shops'
import Surveys from './pages/Surveys'
import Wishlist from './pages/Wishlist'

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/shops', label: 'Shops' },
  { to: '/surveys', label: 'Surveys' },
  { to: '/import', label: 'Import' },
  { to: '/imports', label: 'Import history' },
  { to: '/review', label: 'Match review' },
  { to: '/products', label: 'Product master' },
  { to: '/compare', label: 'Compare prices' },
  { to: '/opportunities', label: 'Best opportunities' },
  { to: '/wishlist', label: 'My Wishlist' },
  { to: '/export', label: 'Export' },
  { to: '/settings', label: 'Settings' },
]
const BOTTOM = [
  { to: '/', label: 'Home', end: true },
  { to: '/compare', label: 'Compare' },
  { to: '/import', label: 'Import' },
  { to: '/wishlist', label: 'Wishlist' },
]

function Shell() {
  const { email, role, signOut } = useAuth()
  const { loading, error, reload, review } = useData()
  const [more, setMore] = useState(false)
  const loc = useLocation()
  const link = (n: { to: string; label: string; end?: boolean }, cls: (a: boolean) => string) => (
    <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setMore(false)} className={({ isActive }) => cls(isActive)}>
      {n.label}
      {n.to === '/review' && review.length > 0 && <span className="ml-2 rounded-full bg-amber-500 px-2 text-xs font-bold text-white">{review.length}</span>}
    </NavLink>
  )
  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <aside className="hidden w-56 shrink-0 border-r border-slate-200 bg-white md:block">
        <div className="p-4 text-lg font-extrabold text-emerald-800">Wholesale Price Intelligence</div>
        <nav className="flex flex-col gap-1 px-2">
          {NAV.map((n) => link(n, (a) => cx('rounded-lg px-3 py-2.5 text-sm font-medium', a ? 'bg-emerald-100 text-emerald-900' : 'text-slate-700 hover:bg-slate-100')))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2">
          <div className="truncate font-bold text-emerald-800 md:hidden">Price Intelligence</div>
          <div className="hidden text-sm text-slate-600 md:block">Shared workspace</div>
          <div className="flex items-center gap-2 text-sm">
            <span className="hidden max-w-48 truncate text-slate-600 sm:inline">{email} ({role})</span>
            <Button variant="secondary" small onClick={() => void reload()}>Refresh</Button>
            <Button variant="ghost" small onClick={() => void signOut()}>Sign out</Button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-4 md:pb-8" key={loc.pathname.split('/')[1]}>
          {error && <div role="alert" className="mb-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">Could not load shared data: {error}. An internet connection is required.</div>}
          {loading ? <Spinner label="Loading shared data…" /> : <Outlet />}
        </main>
      </div>
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-slate-200 bg-white md:hidden">
        {BOTTOM.map((n) => link(n, (a) => cx('flex min-h-14 items-center justify-center text-sm font-semibold', a ? 'text-emerald-800 bg-emerald-50' : 'text-slate-600')))}
        <button onClick={() => setMore(true)} className="min-h-14 text-sm font-semibold text-slate-600">More</button>
      </nav>
      {more && (
        <div className="fixed inset-0 z-50 bg-black/50 md:hidden" onClick={() => setMore(false)}>
          <div className="safe-bottom absolute inset-x-0 bottom-0 rounded-t-2xl bg-white p-3" onClick={(e) => e.stopPropagation()}>
            <div className="grid grid-cols-2 gap-2">
              {NAV.map((n) => link(n, () => 'flex min-h-12 items-center rounded-lg bg-slate-100 px-3 text-sm font-semibold text-slate-800'))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Guard() {
  const { loading, session, noWorkspace, signOut } = useAuth()
  if (loading) return <Spinner />
  if (!session) return <Navigate to="/login" replace />
  if (noWorkspace) {
    return (
      <div className="mx-auto max-w-md p-6">
        <h1 className="text-lg font-bold">No workspace access</h1>
        <p className="mt-2 text-slate-700">This account is not a member of the business workspace. Ask the admin to create your account from the Supabase dashboard.</p>
        <Button className="mt-4" onClick={() => void signOut()}>Sign out</Button>
      </div>
    )
  }
  return (
    <DataProvider>
      <Shell />
    </DataProvider>
  )
}

function SetupNeeded() {
  return (
    <div className="mx-auto max-w-lg p-6">
      <h1 className="text-xl font-bold">Configuration needed</h1>
      <p className="mt-2 text-slate-700">Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (see <code>.env.example</code> and <code>docs/SETUP.md</code>), then restart.</p>
    </div>
  )
}

export default function App() {
  if (!configured) return <SetupNeeded />
  return (
    <UiProvider>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Guard />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/shops" element={<Shops />} />
            <Route path="/shops/:id" element={<ShopDetail />} />
            <Route path="/surveys" element={<Surveys />} />
            <Route path="/import" element={<ImportWizard />} />
            <Route path="/imports" element={<ImportHistory />} />
            <Route path="/review" element={<Review />} />
            <Route path="/products" element={<Products />} />
            <Route path="/products/:id" element={<ProductDetail />} />
            <Route path="/compare" element={<Compare />} />
            <Route path="/opportunities" element={<Opportunities />} />
            <Route path="/wishlist" element={<Wishlist />} />
            <Route path="/export" element={<ExportCenter />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </UiProvider>
  )
}
