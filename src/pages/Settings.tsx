import { useState } from 'react'
import { Badge, Button, Card, Field, PageHeader, Select, ThemeSelector, fmtDate, useToast } from '../components/ui'
import { useAuth } from '../lib/auth'
import { useData } from '../lib/data'
import { supabase } from '../lib/supabase'
import { useTheme } from '../lib/theme'

export default function Settings() {
  const { isAdmin, email, role, userId, workspaceId } = useAuth()
  const { members, settings, policy, reload } = useData()
  const { mode, resolved } = useTheme()
  const toast = useToast()
  const [days, setDays] = useState(settings.freshness_days)
  const [reqMfr, setReqMfr] = useState(policy.requireManufacturerAgreement)
  const [packOnly, setPackOnly] = useState(policy.allowPackOnlyWhenManufacturerAgrees)

  const save = async () => {
    const { error } = await supabase
      .from('workspaces')
      .update({
        settings: {
          ...settings,
          freshness_days: days,
          match_policy: { requireManufacturerAgreement: reqMfr, allowPackOnlyWhenManufacturerAgrees: packOnly },
        },
      })
      .eq('id', workspaceId!)
    if (error) return toast('err', error.message)
    await reload()
    toast('ok', 'Workspace settings saved')
  }

  const setRole = async (uid: string, r: string) => {
    const { error } = await supabase.from('workspace_members').update({ role: r }).eq('user_id', uid).eq('workspace_id', workspaceId!)
    if (error) return toast('err', error.message)
    await reload()
    toast('ok', 'Role updated')
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Settings"
        subtitle="Configure appearance preferences, shared workspace members, price freshness thresholds, and product matching rules."
      />

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-medium text-[var(--text-primary)]">Appearance</h2>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
              Choose Light, Dark, or System mode. Currently using <b className="font-medium text-[var(--text-primary)]">{mode}</b>
              {mode === 'system' ? ` (${resolved})` : ''}.
            </p>
          </div>
          <ThemeSelector />
        </div>
      </Card>

      <Card>
        <h2 className="mb-1.5 text-base font-medium text-[var(--text-primary)]">Workspace members</h2>
        <p className="mb-3 text-sm text-[var(--text-secondary)]">
          Both accounts see the same shops, products, prices, wishlist and match decisions. You are signed in as{' '}
          <b className="font-medium text-[var(--text-primary)]">{email}</b> ({role}).
        </p>
        <div className="space-y-2">
          {members.map((m) => (
            <div key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-subtle)] p-2.5">
              <div>
                <b className="font-medium text-[var(--text-primary)]">{m.email}</b> {m.user_id === userId && <Badge tone="blue">you</Badge>}
              </div>
              {isAdmin && m.user_id !== userId ? (
                <Select className="!w-auto" value={m.role} onChange={(e) => void setRole(m.user_id, e.target.value)}>
                  <option value="admin">Admin</option>
                  <option value="partner">Partner</option>
                </Select>
              ) : (
                <Badge tone={m.role === 'admin' ? 'blue' : 'slate'}>{m.role}</Badge>
              )}
            </div>
          ))}
        </div>
        <p className="mt-2.5 text-xs text-[var(--text-secondary)]">
          To add your partner: Supabase dashboard → Authentication → Users → Add user (set email + password, tick “Auto confirm”). They are joined to this workspace automatically as Partner. Public sign-up must stay disabled. The workspace is capped at 2 members. See docs/SETUP.md.
        </p>
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-medium text-[var(--text-primary)]">Price freshness &amp; matching policy</h2>
          {!isAdmin && <Badge>admin only</Badge>}
        </div>
        <Field label="Quote counts as recent for (days)">
          <Select disabled={!isAdmin} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[7, 15, 30, 60, 90].map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex items-start gap-2 text-sm text-[var(--text-primary)]">
          <input disabled={!isAdmin} type="checkbox" className="mt-1" checked={reqMfr} onChange={(e) => setReqMfr(e.target.checked)} />
          <span>Strict: only auto-accept a match when the manufacturer is known on both sides and agrees (otherwise send to review)</span>
        </label>
        <label className="flex items-start gap-2 text-sm text-[var(--text-primary)]">
          <input disabled={!isAdmin} type="checkbox" className="mt-1" checked={packOnly} onChange={(e) => setPackOnly(e.target.checked)} />
          <span>Allow “same name + same pack size + same manufacturer” as a strong match when no strength / grams exist</span>
        </label>
        <p className="text-xs text-[var(--text-secondary)]">
          Whatever the policy, different grams, strengths, dosage forms or pack sizes are never merged automatically, and ambiguous matches always go to review.
        </p>
        {isAdmin && <Button onClick={save}>Save settings</Button>}
      </Card>

      <Card>
        <h2 className="text-base font-medium text-[var(--text-primary)]">About this app</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--text-secondary)]">
          <li>An internet connection is required. Nothing is stored offline, and uploads cannot run in the background.</li>
          <li>Install on Android: Chrome menu → “Install app” / “Add to Home screen”.</li>
          <li>This app is separate from your ERP. It never connects to it: use the Export center and import the file there.</li>
          <li>Data last loaded {fmtDate(new Date().toISOString())}. Use Refresh to pick up your partner's changes.</li>
        </ul>
      </Card>
    </div>
  )
}
