import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
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
    <div className="mx-auto flex min-h-full max-w-sm flex-col justify-center p-4">
      <h1 className="mb-1 text-2xl font-extrabold text-emerald-800">Wholesale Price Intelligence</h1>
      <p className="mb-4 text-sm text-slate-600">Sign in with your personal account. Both partners see the same shared data. Internet connection required.</p>
      <Card>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Email"><Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Password"><Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          {err && <ErrorBox>{err}</ErrorBox>}
          <Button type="submit" disabled={busy} className="w-full">{busy ? 'Signing in…' : 'Sign in'}</Button>
        </form>
      </Card>
    </div>
  )
}
