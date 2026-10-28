import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { IconBrandMark, IconUsers } from '../components/icons'
import { Button, Card, ErrorBox, Field, Input, Spinner } from '../components/ui'
import { useAuth } from '../lib/auth'

export default function Login() {
  const { session, loading, signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (loading) return <Spinner />
  if (session) return <Navigate to="/" replace />
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    const m = await signIn(email.trim(), password)
    setBusy(false)
    if (m) setErr(m)
  }
  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-6 flex flex-col items-center text-center">
        <IconBrandMark size={40} />
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">Wholesale Price Intelligence</h1>
        <p className="mt-1 text-sm text-slate-600">Medical wholesale market price comparison &amp; supplier survey system</p>
      </div>

      <Card className="p-6">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email address">
            <Input
              type="email"
              autoComplete="username"
              placeholder="name@business.com"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              autoComplete="current-password"
              placeholder="Enter your password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {err && <ErrorBox>{err}</ErrorBox>}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'Signing in…' : 'Sign in to workspace'}
          </Button>
        </form>

        <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs text-slate-600">
          <IconUsers size={16} className="mt-0.5 shrink-0 text-teal-700" />
          <span>Sign in with your personal partner account. Both partners share the same shops, products, price lists, and wishlist in real time.</span>
        </div>
      </Card>
    </div>
  )
}
