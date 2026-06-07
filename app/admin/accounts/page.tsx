'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

type Account = { username: string; createdAt: string }

export default function AdminAccountsPage() {
  const router = useRouter()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  // Check super admin role
  useEffect(() => {
    fetch('/api/admin/me')
      .then(r => r.json())
      .then(data => {
        if (data.role === 'super') {
          setIsAuthorized(true)
          fetchAccounts()
        } else {
          setIsAuthorized(false)
        }
      })
      .catch(() => setIsAuthorized(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function fetchAccounts() {
    const res = await fetch('/api/admin/accounts')
    const data = await res.json()
    if (Array.isArray(data)) setAccounts(data)
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!username.trim() || !password.trim()) {
      showToast('아이디와 비밀번호를 입력하세요.', 'error')
      return
    }
    setIsSubmitting(true)
    try {
      const res = await fetch('/api/admin/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      const data = await res.json()
      if (!res.ok) { showToast(data.error ?? '생성 실패', 'error'); return }
      setUsername('')
      setPassword('')
      await fetchAccounts()
      showToast(`✅ [${username.trim()}] 계정이 생성되었습니다.`)
    } catch {
      showToast('서버 오류가 발생했습니다.', 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleDelete(uname: string) {
    if (!confirm(`[${uname}] 계정을 삭제하시겠습니까?`)) return
    setDeletingId(uname)
    try {
      const res = await fetch('/api/admin/accounts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: uname }),
      })
      if (!res.ok) throw new Error()
      await fetchAccounts()
      showToast('계정이 삭제되었습니다.')
    } catch {
      showToast('삭제 실패.', 'error')
    } finally {
      setDeletingId(null)
    }
  }

  async function handleLogout() {
    await fetch('/api/admin/logout', { method: 'POST' })
    window.location.href = '/admin/login'
  }

  // Loading
  if (isAuthorized === null) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-500 text-sm">확인 중...</div>
      </div>
    )
  }

  // Not authorized
  if (!isAuthorized) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-4">
        <div className="text-4xl">🔒</div>
        <p className="text-white font-bold text-lg">접근 권한이 없습니다</p>
        <p className="text-gray-500 text-sm">총괄 관리자만 접근할 수 있습니다.</p>
        <button
          onClick={() => router.push('/admin/products')}
          className="mt-2 text-sm text-gray-400 hover:text-white transition-colors"
        >
          ← 상품 관리로 돌아가기
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950">

      {/* ── Nav ── */}
      <nav className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <span className="text-xl font-black text-white">👑 총괄 관리자</span>
          <span className="text-gray-700">|</span>
          <span className="text-sm text-gray-400">계정 관리</span>
        </div>
        <div className="flex items-center gap-4">
          <a href="/admin/products" className="text-sm text-gray-400 hover:text-gray-200 transition-colors">
            상품 관리
          </a>
          <a href="/admin/chat" className="text-sm text-gray-400 hover:text-gray-200 transition-colors">
            채팅 상담
          </a>
          <button
            onClick={handleLogout}
            className="text-sm text-gray-500 hover:text-red-400 transition-colors font-medium"
          >
            로그아웃
          </button>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-4 py-10 space-y-8">

        {/* ── Header ── */}
        <div>
          <h1 className="text-2xl font-black text-white mb-1">서브 관리자 계정 관리</h1>
          <p className="text-gray-500 text-sm">
            서브 관리자는 상품 관리 및 채팅 상담에 접근할 수 있습니다.<br />
            총괄 관리자 계정 설정 페이지에는 접근할 수 없습니다.
          </p>
        </div>

        {/* ── Create form ── */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-800">
            <h2 className="text-white font-bold text-base">+ 새 서브 관리자 추가</h2>
          </div>
          <form onSubmit={handleCreate} className="p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1.5">아이디</label>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="예: manager01"
                  autoComplete="off"
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1.5">비밀번호</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 pr-14 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    {showPw ? '숨김' : '표시'}
                  </button>
                </div>
              </div>
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 text-white font-bold rounded-xl transition-all active:scale-95 disabled:opacity-50 text-sm"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}
            >
              {isSubmitting ? '생성 중...' : '계정 생성'}
            </button>
          </form>
        </div>

        {/* ── Account list ── */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
            <h2 className="text-white font-bold text-base">서브 관리자 목록</h2>
            <span className="text-xs text-gray-500">{accounts.length}개 계정</span>
          </div>

          {accounts.length === 0 ? (
            <div className="px-5 py-10 text-center text-gray-600 text-sm">
              등록된 서브 관리자가 없습니다.
            </div>
          ) : (
            <ul className="divide-y divide-gray-800">
              {accounts.map(acc => (
                <li key={acc.username} className="flex items-center justify-between px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-purple-900 flex items-center justify-center text-purple-300 font-bold text-sm flex-shrink-0">
                      {acc.username[0].toUpperCase()}
                    </div>
                    <div>
                      <p className="text-white font-semibold text-sm">{acc.username}</p>
                      <p className="text-gray-600 text-xs">
                        생성: {new Date(acc.createdAt).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(acc.username)}
                    disabled={deletingId === acc.username}
                    className="text-xs text-gray-600 hover:text-red-400 border border-gray-700 hover:border-red-800 font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                  >
                    삭제
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ── Super admin info ── */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h3 className="text-white font-bold text-sm mb-3">👑 총괄 관리자 계정</h3>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-yellow-900 flex items-center justify-center text-yellow-400 font-bold text-sm flex-shrink-0">
              A
            </div>
            <div>
              <p className="text-white font-semibold text-sm">admin</p>
              <p className="text-gray-600 text-xs">총괄 관리자 · 모든 권한 보유</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Toast ── */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-2xl text-white text-sm font-semibold shadow-xl z-50 ${toast.type === 'error' ? 'bg-red-500' : 'bg-gray-700'}`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
