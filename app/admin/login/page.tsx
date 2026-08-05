'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

// ── Inner component — uses useSearchParams, must be inside <Suspense> ─────────

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const from = searchParams.get('from') ?? '/admin/products'

  // Redirect if already logged in
  useEffect(() => {
    fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: '', password: '' }) })
      .then(r => { if (r.status !== 401) router.replace(from) })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!username || !password) { setError('아이디와 비밀번호를 입력해주세요.'); return }
    setIsLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? '로그인 실패'); return }
      router.replace(from)
    } catch {
      setError('서버 오류가 발생했습니다.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="w-full max-w-sm">

      {/* Branding */}
      <div className="text-center mb-8">
        <div
          className="inline-flex items-center gap-2 text-white font-black text-base px-5 py-2.5 rounded-2xl shadow-lg mb-3"
          style={{ background: 'linear-gradient(135deg, #ff6a00, #e53935)' }}
        >
          📺 LIVE SHOP
        </div>
        <p className="text-gray-500 text-sm">관리자 전용 패널</p>
      </div>

      {/* Card */}
      <div className="bg-white rounded-3xl shadow-2xl p-7">
        <h1 className="text-xl font-black text-gray-900 mb-1">관리자 로그인</h1>
        <p className="text-sm text-gray-400 mb-6">허가된 관리자만 접근 가능합니다.</p>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-2.5 rounded-xl mb-4 flex items-center gap-2">
            <span>⚠️</span>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Username */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">아이디</label>
            <input
              type="text"
              value={username}
              onChange={e => { setUsername(e.target.value); setError('') }}
              placeholder="admin"
              autoComplete="username"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent transition"
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">비밀번호</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => { setPassword(e.target.value); setError('') }}
                placeholder="••••••••"
                autoComplete="current-password"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 pr-14 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent transition"
              />
              <button
                type="button"
                onClick={() => setShowPw(p => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-gray-400 hover:text-gray-600 px-1 py-0.5 rounded transition-colors"
              >
                {showPw ? '숨김' : '표시'}
              </button>
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3.5 text-white font-black rounded-xl transition-all active:scale-95 disabled:opacity-60 shadow-lg mt-2"
            style={{ background: 'linear-gradient(135deg, #ff6a00, #e53935)' }}
          >
            {isLoading ? '로그인 중...' : '로그인'}
          </button>
        </form>
      </div>

      <p className="text-center text-xs text-gray-600 mt-6">
        <a href="/living-live" className="hover:text-gray-400 transition-colors">← 라이브 페이지로 돌아가기</a>
      </p>
    </div>
  )
}

// ── Page — wraps LoginForm in Suspense to satisfy Next.js static build ────────

export default function AdminLoginPage() {
  return (
    <div className="min-h-screen-safe bg-gradient-to-br from-gray-950 via-slate-900 to-black flex items-center justify-center px-4">
      <Suspense fallback={<div className="text-gray-600 text-sm">불러오는 중...</div>}>
        <LoginForm />
      </Suspense>
    </div>
  )
}
