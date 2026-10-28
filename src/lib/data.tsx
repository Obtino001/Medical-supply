// Shared workspace data. Everything here comes from the shared Supabase database; both partners read the same rows.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAuth } from './auth'
import { DEFAULT_POLICY, type MatchPolicy } from './matching'
import { fetchAll, supabase } from './supabase'
import type { Member, OpportunityStatus, PriceRecord, Product, RecordLite, Shop, Survey, WishlistItem } from './types'

export interface WorkspaceSettings {
  freshness_days: number
  match_policy?: Partial<MatchPolicy>
}

interface DataState {
  loading: boolean
  error: string | null
  shops: Shop[]
  shopMap: Map<string, Shop>
  surveys: Survey[]
  products: Product[]
  productMap: Map<string, Product>
  current: PriceRecord[] // latest matched record per product + shop
  history: RecordLite[]
  review: PriceRecord[] // records with no confirmed product
  wishlist: WishlistItem[]
  wishlistMap: Map<string, WishlistItem>
  opportunityStatus: Map<string, OpportunityStatus>
  members: Member[]
  memberName: (userId: string | null | undefined) => string
  settings: WorkspaceSettings
  policy: MatchPolicy
  selected: Set<string>
  setSelected: (s: Set<string>) => void
  reload: () => Promise<void>
}

const Ctx = createContext<DataState | null>(null)
export const useData = () => useContext(Ctx)!

export function DataProvider({ children }: { children: ReactNode }) {
  const { workspaceId } = useAuth()
  const [state, setState] = useState<Omit<DataState, 'shopMap' | 'productMap' | 'wishlistMap' | 'memberName' | 'policy' | 'selected' | 'setSelected' | 'reload'>>({
    loading: true, error: null, shops: [], surveys: [], products: [], current: [], history: [], review: [],
    wishlist: [], opportunityStatus: new Map(), members: [], settings: { freshness_days: 15 },
  })
  const [selected, setSelectedState] = useState<Set<string>>(() => {
    try { return new Set<string>(JSON.parse(sessionStorage.getItem('selectedProducts') ?? '[]')) } catch { return new Set() }
  })
  const setSelected = (s: Set<string>) => {
    setSelectedState(s)
    try { sessionStorage.setItem('selectedProducts', JSON.stringify([...s])) } catch { /* ignore */ }
  }
  const lastLoad = useRef(0)

  const reload = useCallback(async () => {
    if (!workspaceId) return
    lastLoad.current = Date.now()
    try {
      const [shops, surveys, products, current, history, review, wishlist, opp, members, ws] = await Promise.all([
        fetchAll<Shop>((a, b) => supabase.from('shops').select('*').order('name').range(a, b)),
        fetchAll<Survey>((a, b) => supabase.from('surveys').select('*').order('survey_date', { ascending: false }).range(a, b)),
        fetchAll<Product>((a, b) => supabase.from('products').select('*').order('product_no').range(a, b)),
        fetchAll<PriceRecord>((a, b) => supabase.from('current_offers').select('*').order('id').range(a, b)),
        fetchAll<RecordLite>((a, b) => supabase.from('price_records').select('id,product_id,shop_id,observed_on,effective_cost,scheme_status,created_at').eq('archived', false).not('product_id', 'is', null).order('id').range(a, b)),
        fetchAll<PriceRecord>((a, b) => supabase.from('price_records').select('*').eq('archived', false).is('product_id', null).order('created_at', { ascending: false }).range(a, b)),
        fetchAll<WishlistItem>((a, b) => supabase.from('wishlist_items').select('*').order('created_at').range(a, b)),
        fetchAll<OpportunityStatus>((a, b) => supabase.from('opportunity_status').select('product_id,status,note').range(a, b)),
        supabase.from('workspace_members').select('user_id,role,email,display_name').then((r) => (r.data ?? []) as Member[]),
        supabase.from('workspaces').select('settings').eq('id', workspaceId).maybeSingle().then((r) => (r.data?.settings ?? {}) as Partial<WorkspaceSettings>),
      ])
      setState({
        loading: false, error: null, shops, surveys, products, current, history, review, wishlist,
        opportunityStatus: new Map(opp.map((o) => [o.product_id, o])), members,
        settings: { freshness_days: 15, ...ws },
      })
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: (e as Error).message }))
    }
  }, [workspaceId])

  useEffect(() => { void reload() }, [reload])

  // Pick up the other partner's changes when this device regains focus.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastLoad.current > 20000) void reload()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [reload])

  const value = useMemo<DataState>(() => {
    const members = state.members
    return {
      ...state,
      shopMap: new Map(state.shops.map((s) => [s.id, s])),
      productMap: new Map(state.products.map((p) => [p.id, p])),
      wishlistMap: new Map(state.wishlist.map((w) => [w.product_id, w])),
      memberName: (id) => {
        if (!id) return 'system'
        const m = members.find((x) => x.user_id === id)
        return m?.display_name || m?.email?.split('@')[0] || 'user'
      },
      policy: { ...DEFAULT_POLICY, ...(state.settings.match_policy ?? {}) },
      selected, setSelected, reload,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, selected, reload])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
