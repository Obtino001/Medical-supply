import { useState, type ComponentType } from 'react'
import { Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import {
  IconAlert,
  IconBrandMark,
  IconCalendar,
  IconClose,
  IconDashboard,
  IconDownload,
  IconGitCompare,
  IconHistory,
  IconLogOut,
  IconMenu,
  IconPackage,
  IconRefresh,
  IconScale,
  IconSettings,
  IconStar,
  IconStore,
  IconTrendingDown,
  IconUpload,
  IconUsers,
  type IconProps,
} from './components/icons'
import { Badge, Button, Spinner, ThemeSelector, ThemeToggleButton, UiProvider, cx } from './components/ui'
import { AuthProvider, useAuth } from './lib/auth'
import { DataProvider, useData } from './lib/data'
import { configured } from './lib/supabase'
import { ThemeProvider } from './lib/theme'
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

interface NavItem {
  to: string
  label: string
  end?: boolean
  icon: ComponentType<IconProps>
  group: 'Market Intelligence' | 'Suppliers & Imports' | 'Workspace'
}

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', end: true, icon: IconDashboard, group: 'Market Intelligence' },
  { to: '/compare', label: 'Compare Prices', icon: IconScale, group: 'Market Intelligence' },
  { to: '/opportunities', label: 'Best Opportunities', icon: IconTrendingDown, group: 'Market Intelligence' },
  { to: '/wishlist', label: 'My Wishlist', icon: IconStar, group: 'Market Intelligence' },
  { to: '/products', label: 'Product Master', icon: IconPackage, group: 'Market Intelligence' },
  { to: '/shops', label: 'Shops', icon: IconStore, group: 'Suppliers & Imports' },
  { to: '/import', label: 'Import Price List', icon: IconUpload, group: 'Suppliers & Imports' },
  { to: '/review', label: 'Match Review', icon: IconGitCompare, group: 'Suppliers & Imports' },
  { to: '/surveys', label: 'Surveys', icon: IconCalendar, group: 'Suppliers & Imports' },
  { to: '/imports', label: 'Import History', icon: IconHistory, group: 'Suppliers & Imports' },
  { to: '/export', label: 'Export Center', icon: IconDownload, group: 'Workspace' },
  { to: '/settings', label: 'Settings', icon: IconSettings, group: 'Workspace' },
]

const GROUPS: NavItem['group'][] = ['Market Intelligence', 'Suppliers & Imports', 'Workspace']

const BOTTOM: { to: string; label: string; end?: boolean; icon: ComponentType<IconProps> }[] = [
  { to: '/', label: 'Home', end: true, icon: IconDashboard },
  { to: '/compare', label: 'Compare', icon: IconScale },
  { to: '/import', label: 'Import', icon: IconUpload },
  { to: '/wishlist', label: 'Wishlist', icon: IconStar },
]

function Shell() {
  const { email, role, signOut } = useAuth()
  const { loading, error, reload, review } = useData()
  const [more, setMore] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const loc = useLocation()

  const activeNav =
    NAV.find((n) => (n.end ? loc.pathname === n.to : loc.pathname === n.to || loc.pathname.startsWith(n.to + '/'))) ?? NAV[0]

  const doReload = async () => {
    setRefreshing(true)
    try {
      await reload()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="flex min-h-full w-full max-w-full flex-col overflow-x-clip bg-[var(--bg-app)] text-[var(--text-primary)] md:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-[var(--border-default)] bg-[var(--bg-nav)] md:sticky md:top-0 md:flex md:h-screen">
        <div className="flex items-center gap-2.5 border-b border-[var(--border-default)] px-4 py-3.5">
          <IconBrandMark size={28} />
          <div className="min-w-0">
            <div className="truncate text-[15px] font-medium tracking-tight text-[var(--text-primary)]">Price Intelligence</div>
            <div className="truncate text-[11px] text-[var(--text-secondary)]">Wholesale Market System</div>
          </div>
        </div>

        <nav className="flex-1 divide-y divide-[var(--border-default)]/60 overflow-y-auto px-2.5 py-2" aria-label="Main navigation">
          {GROUPS.map((group) => (
            <div key={group} className="py-2 first:pt-1 last:pb-1">
              <div className="mb-1 px-3 text-[11px] font-medium tracking-wider text-[var(--text-secondary)] uppercase">{group}</div>
              <div className="space-y-0.5">
                {NAV.filter((n) => n.group === group).map((n) => {
                  const Icon = n.icon
                  return (
                    <NavLink
                      key={n.to}
                      to={n.to}
                      end={n.end}
                      className={({ isActive }) =>
                        cx(
                          'group flex items-center justify-between rounded-full px-3 py-1.5 text-[13.5px] font-medium transition-colors duration-150',
                          isActive
                            ? 'bg-[var(--color-primary-light)] text-[var(--color-primary)]'
                            : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <span className="flex items-center gap-2.5 truncate">
                            <Icon
                              size={17}
                              className={cx(
                                'shrink-0 transition-colors',
                                isActive ? 'text-[var(--color-primary)]' : 'text-[var(--text-secondary)] group-hover:text-[var(--color-primary)]',
                              )}
                            />
                            <span className="truncate">{n.label}</span>
                          </span>
                          {n.to === '/review' && review.length > 0 && (
                            <span className="ml-2 rounded-full bg-[var(--color-warning)] px-2 py-0.5 text-[11px] font-semibold text-[#202124] tabular-nums">
                              {review.length}
                            </span>
                          )}
                        </>
                      )}
                    </NavLink>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-[var(--border-default)] p-3">
          <div className="flex items-center gap-2.5 rounded-lg bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-secondary)]">
            <IconUsers size={16} className="shrink-0 text-[var(--color-primary)]" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-[var(--text-primary)]">{email}</div>
              <div className="capitalize text-[11px] text-[var(--text-secondary)]">Shared workspace · {role}</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex min-w-0 max-w-full flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-13.5 items-center justify-between gap-2 border-b border-[var(--border-default)] bg-[var(--bg-nav)] px-3 sm:gap-3 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-2.5">
            <button
              type="button"
              onClick={() => setMore(true)}
              aria-label="Open navigation menu"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] md:hidden"
            >
              <IconMenu size={18} />
            </button>
            <div className="flex shrink-0 items-center gap-2 md:hidden">
              <IconBrandMark size={24} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-[var(--text-primary)] sm:text-[15px]">{activeNav.label}</div>
            </div>
            <span className="hidden shrink-0 items-center gap-1.5 rounded-full bg-[var(--color-primary-light)] px-2.5 py-0.5 text-xs font-medium text-[var(--color-primary)] lg:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-primary)]" />
              Shared Workspace
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <div className="hidden items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2.5 py-1 text-xs text-[var(--text-secondary)] md:flex">
              <span className="max-w-40 truncate font-medium text-[var(--text-primary)]">{email}</span>
              <Badge tone={role === 'admin' ? 'blue' : 'slate'}>{role}</Badge>
            </div>
            <ThemeToggleButton />
            <Button variant="secondary" small onClick={() => void doReload()} disabled={refreshing} title="Sync partner changes">
              <IconRefresh size={15} className={cx('text-[var(--color-primary)]', refreshing && 'animate-spin')} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            <Button variant="ghost" small onClick={() => void signOut()} title="Sign out">
              <IconLogOut size={15} />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl min-w-0 flex-1 overflow-x-clip px-3 pb-28 pt-3.5 sm:px-6 md:pb-10 md:pt-5" key={loc.pathname.split('/')[1]}>
          {error && (
            <div role="alert" className="mb-4 flex items-start gap-2.5 rounded-lg border border-[var(--color-error-border)] bg-[var(--color-error-bg)] p-3.5 text-sm text-[var(--color-error-text)]">
              <IconAlert size={18} className="mt-0.5 shrink-0 text-[var(--color-error-text)]" />
              <div>Could not load shared workspace data: {error}. Please check your internet connection and click Refresh.</div>
            </div>
          )}
          {loading ? <Spinner label="Loading shared workspace…" /> : <Outlet />}
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <nav
        aria-label="Mobile quick navigation"
        className="safe-bottom fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-[var(--border-default)] bg-[var(--bg-nav)] px-1 md:hidden"
      >
        {BOTTOM.map((n) => {
          const Icon = n.icon
          return (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              onClick={() => setMore(false)}
              className={({ isActive }) =>
                cx(
                  'flex min-h-14 flex-col items-center justify-center gap-0.5 py-1 text-[11px] font-medium transition-colors',
                  isActive ? 'text-[var(--color-primary)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cx(
                      'inline-flex h-7 w-12 items-center justify-center rounded-full transition-colors',
                      isActive && 'bg-[var(--color-primary-light)]',
                    )}
                  >
                    <Icon size={18} className={isActive ? 'text-[var(--color-primary)]' : 'text-[var(--text-secondary)]'} />
                  </span>
                  <span>{n.label}</span>
                </>
              )}
            </NavLink>
          )
        })}
        <button
          type="button"
          onClick={() => setMore(true)}
          className={cx(
            'relative flex min-h-14 flex-col items-center justify-center gap-0.5 py-1 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
            more && 'text-[var(--color-primary)]',
          )}
        >
          <span
            className={cx(
              'inline-flex h-7 w-12 items-center justify-center rounded-full transition-colors',
              more && 'bg-[var(--color-primary-light)]',
            )}
          >
            <IconMenu size={18} className={more ? 'text-[var(--color-primary)]' : 'text-[var(--text-secondary)]'} />
          </span>
          <span>Menu</span>
          {review.length > 0 && (
            <span className="absolute top-1.5 right-4 h-2 w-2 rounded-full bg-[var(--color-warning)]" />
          )}
        </button>
      </nav>

      {/* Mobile Navigation Drawer */}
      {more && (
        <div className="fixed inset-0 z-50 bg-[var(--bg-overlay)] md:hidden" onClick={() => setMore(false)}>
          <div
            className="safe-bottom absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-[var(--border-default)] bg-[var(--bg-surface)] p-4 shadow-[var(--shadow-lg)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-2.5 h-1 w-10 rounded-full bg-[var(--border-default)]" />
            <div className="mb-3 flex items-center justify-between border-b border-[var(--border-default)] pb-3">
              <div className="flex items-center gap-2.5">
                <IconBrandMark size={24} />
                <div>
                  <div className="text-sm font-medium text-[var(--text-primary)]">Wholesale Price Intelligence</div>
                  <div className="text-xs text-[var(--text-secondary)]">{email} ({role})</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMore(false)}
                aria-label="Close menu"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                <IconClose size={18} />
              </button>
            </div>

            <div className="mb-3 flex items-center justify-between rounded-xl border border-[var(--border-default)] bg-[var(--bg-subtle)] px-3 py-2">
              <span className="text-xs font-medium text-[var(--text-secondary)]">Appearance</span>
              <ThemeSelector compact />
            </div>

            <div className="grid grid-cols-2 gap-2">
              {NAV.map((n) => {
                const Icon = n.icon
                return (
                  <NavLink
                    key={n.to}
                    to={n.to}
                    end={n.end}
                    onClick={() => setMore(false)}
                    className={({ isActive }) =>
                      cx(
                        'flex min-h-11 items-center justify-between rounded-xl border px-3 py-2 text-xs font-medium transition-colors',
                        isActive
                          ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] text-[var(--color-primary)]'
                          : 'border-[var(--border-default)] bg-[var(--bg-subtle)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]',
                      )
                    }
                  >
                    <span className="flex items-center gap-2 truncate">
                      <Icon size={16} className="shrink-0 text-[var(--color-primary)]" />
                      <span className="truncate">{n.label}</span>
                    </span>
                    {n.to === '/review' && review.length > 0 && (
                      <span className="ml-1 rounded-full bg-[var(--color-warning)] px-1.5 py-0.5 text-[10px] font-semibold text-[#202124]">
                        {review.length}
                      </span>
                    )}
                  </NavLink>
                )
              })}
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
      <div className="mx-auto flex min-h-full max-w-md flex-col justify-center p-6">
        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-6">
          <h1 className="text-lg font-medium text-[var(--text-primary)]">No workspace access</h1>
          <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
            This account is not linked to the shared business workspace yet. Ask the workspace administrator to add your account in Supabase.
          </p>
          <Button className="mt-5 w-full" onClick={() => void signOut()}>Sign out</Button>
        </div>
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
    <div className="mx-auto flex min-h-full max-w-lg flex-col justify-center p-6">
      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-6">
        <h1 className="text-lg font-medium text-[var(--text-primary)]">Configuration needed</h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
          Set <code className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-xs">VITE_SUPABASE_URL</code> and{' '}
          <code className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-xs">VITE_SUPABASE_ANON_KEY</code> in your <code className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-xs">.env</code> file, then restart the server.
        </p>
      </div>
    </div>
  )
}

export default function App() {
  if (!configured) return <SetupNeeded />
  return (
    <ThemeProvider>
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
    </ThemeProvider>
  )
}
