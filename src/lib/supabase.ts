import { createClient } from '@supabase/supabase-js'

const rawUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
const rawKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()

if (rawKey && (rawKey.startsWith('sb_secret_') || /service_role/i.test(rawKey))) {
  throw new Error('Security error: never use a Supabase secret or service_role key in frontend VITE_* variables.')
}

const isPlaceholder = (val: string | undefined) =>
  !val || val.includes('YOUR-PROJECT-REF') || val.includes('YOUR-ANON-PUBLIC-KEY') || val.includes('YOUR_PUBLISHABLE_KEY')

const url = !isPlaceholder(rawUrl) ? rawUrl : undefined
const key = !isPlaceholder(rawKey) ? rawKey : undefined

export const configured = Boolean(url && key)

// Only the public publishable / anon key is ever used here; all access is limited by row-level security.
export const supabase = createClient(url ?? 'http://localhost:54321', key ?? 'missing-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true },
})

export class ConflictError extends Error {
  constructor() {
    super('Someone else changed this record while you were editing. It has been refreshed: please review and save again.')
  }
}

/** Page through a query 1000 rows at a time (PostgREST default cap). */
export async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

/** Optimistic-concurrency update: fails with ConflictError if the row changed since it was loaded. */
export async function updateChecked(table: string, id: string, loadedUpdatedAt: string, patch: Record<string, unknown>) {
  const { data, error } = await supabase.from(table).update(patch).eq('id', id).eq('updated_at', loadedUpdatedAt).select('id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new ConflictError()
}
