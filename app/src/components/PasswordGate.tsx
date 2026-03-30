import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useUserStore } from '../stores/useUserStore'

type PasswordGateProps = {
  children: ReactNode
}

const API_BASE =
  import.meta.env.REACT_APP_API_URL?.toString().trim() || 'http://localhost:3001'

export default function PasswordGate({ children }: PasswordGateProps) {
  const user = useUserStore((s) => s.user)
  const setUser = useUserStore((s) => s.setUser)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)

    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })

      const json = (await res.json().catch(() => ({}))) as {
        user?: {
          id: string
          username: string
          colour?: string | null
          admin?: boolean
          canRoster?: boolean
        }
        error?: string
      }

      if (!res.ok) {
        setError(
          res.status === 401
            ? 'Incorrect password'
            : json.error || 'Login failed',
        )
        setIsSubmitting(false)
        return
      }

      if (!json.user?.id || !json.user?.username) {
        setError('Incorrect password')
        setIsSubmitting(false)
        return
      }

      setUser({
        id: json.user.id,
        username: json.user.username,
        colour: typeof json.user.colour === 'string' ? json.user.colour : null,
        admin: json.user.admin === true,
        canRoster: json.user.canRoster === true,
      })
      setIsSubmitting(false)
    } catch {
      setError('Could not reach server.')
      setIsSubmitting(false)
    }
  }

  const onChange = (val: string) => {
    setPassword(val)
    if (error) setError(null)
  }

  if (user) {
    return <>{children}</>
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--bg)',
        color: 'var(--text-h)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        zIndex: 999999,
      }}
    >
      <div
        style={{
          width: 'min(420px, 100%)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: 18,
          boxShadow: 'var(--shadow)',
          background: 'color-mix(in srgb, var(--bg) 92%, black 8%)',
        }}
      >
        <h1 style={{ fontSize: 28, margin: '6px 0 10px' }}>Login</h1>

        <p style={{ marginTop: 0, opacity: 0.9, lineHeight: 1.3 }}>
          Enter the password to access the roster.
        </p>

        <form onSubmit={onSubmit} style={{ marginTop: 14 }}>
          <label
            htmlFor="password"
            style={{
              display: 'block',
              fontSize: 14,
              opacity: 0.9,
              marginBottom: 6,
            }}
          >
            Password
          </label>

          <div style={{ position: 'relative' }}>
            <input
              ref={inputRef}
              id="password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => onChange(e.target.value)}
              autoComplete="current-password"
              aria-invalid={!!error}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                borderRadius: 10,
                padding: '10px 40px 10px 12px',
                border: error ? '1px solid var(--bg-danger)' : '1px solid var(--border)',
                background: 'color-mix(in srgb, var(--bg) 85%, white 15%)',
                color: 'var(--text-h)',
                outline: 'none',
              }}
            />

            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              style={{
                position: 'absolute',
                right: 8,
                top: 8,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontSize: 12,
                opacity: 0.7,
              }}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>

          <div
            role="alert"
            aria-live="assertive"
            style={{
              marginTop: 10,
              minHeight: 20,
              color: 'var(--bg-danger)',
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            {error || ''}
          </div>

          <button
            type="submit"
            disabled={!password || isSubmitting}
            style={{
              marginTop: 14,
              width: '100%',
              borderRadius: 10,
              padding: '10px 12px',
              border: '2px solid transparent',
              background: password ? 'var(--primary-500)' : 'var(--border)',
              color: 'white',
              fontSize: 16,
              fontWeight: 700,
              cursor: password ? 'pointer' : 'not-allowed',
              opacity: isSubmitting ? 0.7 : 1,
              transform: isSubmitting ? 'scale(0.98)' : 'scale(1)',
              transition: 'all 120ms ease',
              boxShadow: '0 8px 18px rgba(22, 126, 232, 0.25)',
            }}
          >
            {isSubmitting ? 'Checking...' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  )
}
