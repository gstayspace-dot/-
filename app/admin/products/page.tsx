'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { Product } from '@/lib/types'

const EMPTY_FORM = {
  name: '',
  imageUrl: '',
  originalPrice: '',
  livePrice: '',
  quantity: '',
  specs: '',
}

export default function AdminProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [activeIds, setActiveIds] = useState<string[]>([])
  const [isSuper, setIsSuper] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [livingId, setLivingId] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLDivElement>(null)

  // ── Image helpers ──────────────────────────────────────────────────────────

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)

    const reader = new FileReader()
    reader.onload = (ev) => {
      const img = new window.Image()
      img.onload = () => {
        // Resize to max 800×800, compress to JPEG 72% → ~100 KB per image
        const MAX = 800
        let w = img.width, h = img.height
        if (w > MAX) { h = Math.round(h * MAX / w); w = MAX }
        if (h > MAX) { w = Math.round(w * MAX / h); h = MAX }
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
        setForm(prev => ({ ...prev, imageUrl: canvas.toDataURL('image/jpeg', 0.72) }))
      }
      img.src = ev.target?.result as string
    }
    reader.readAsDataURL(file)
  }

  function clearImage() {
    setFileName('')
    setForm(prev => ({ ...prev, imageUrl: '' }))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ── Toast ──────────────────────────────────────────────────────────────────

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    const [prodRes, liveRes] = await Promise.all([fetch('/api/products'), fetch('/api/live')])
    const prods: Product[] = await prodRes.json()
    const { products: liveProds } = await liveRes.json()
    setProducts(prods)
    setActiveIds((liveProds ?? []).map((p: Product) => p.id))
  }, [])

  useEffect(() => {
    fetchData()
    fetch('/api/admin/me').then(r => r.json()).then(d => { if (d.role === 'super') setIsSuper(true) }).catch(() => {})
  }, [fetchData])

  // ── Edit mode ──────────────────────────────────────────────────────────────

  function startEdit(product: Product) {
    setEditingId(product.id)
    setFileName(product.imageUrl?.startsWith('data:') ? '(기존 이미지)' : '')
    setForm({
      name: product.name,
      imageUrl: product.imageUrl,
      originalPrice: String(product.originalPrice),
      livePrice: String(product.livePrice),
      quantity: String(product.quantity),
      specs: product.specs,
    })
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function cancelEdit() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFileName('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const discountPct =
    form.originalPrice && form.livePrice
      ? Math.round((1 - Number(form.livePrice) / Number(form.originalPrice)) * 100)
      : null

  const activeProducts = products.filter(p => activeIds.includes(p.id))

  // ── CRUD handlers ──────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name || !form.originalPrice || !form.livePrice || !form.quantity) {
      showToast('필수 항목을 모두 입력하세요.', 'error')
      return
    }
    setIsSubmitting(true)
    try {
      const url = editingId ? `/api/products/${editingId}` : '/api/products'
      const method = editingId ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error()
      setForm(EMPTY_FORM)
      setFileName('')
      setEditingId(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      await fetchData()
      showToast(editingId ? '상품이 수정되었습니다! ✅' : '상품이 등록되었습니다!')
    } catch {
      showToast(editingId ? '수정 실패. 다시 시도해주세요.' : '등록 실패. 다시 시도해주세요.', 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleSetLive(productId: string) {
    if (activeIds.includes(productId)) return
    setLivingId(productId)
    try {
      const res = await fetch('/api/live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId }),
      })
      const data = await res.json()
      if (!res.ok) { showToast(data.error ?? '송출 전환 실패.', 'error'); return }
      setActiveIds(prev => [...prev, productId])
      showToast('🔴 LIVE 송출이 시작되었습니다!')
    } catch {
      showToast('송출 전환 실패.', 'error')
    } finally {
      setLivingId(null)
    }
  }

  async function handleStopLive(productId: string) {
    try {
      await fetch('/api/live', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId }),
      })
      setActiveIds(prev => prev.filter(id => id !== productId))
      showToast('송출이 중단되었습니다.')
    } catch {
      showToast('오류가 발생했습니다.', 'error')
    }
  }

  async function handleStopAll() {
    try {
      await fetch('/api/live', { method: 'DELETE' })
      setActiveIds([])
      showToast('전체 송출이 중단되었습니다.')
    } catch {
      showToast('오류가 발생했습니다.', 'error')
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('상품을 삭제하시겠습니까?')) return
    setDeletingId(id)
    try {
      const res = await fetch(`/api/products/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      if (editingId === id) cancelEdit()
      await fetchData()
      showToast('상품이 삭제되었습니다.')
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

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── Nav ── */}
      <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="text-xl font-black text-gray-900">🛠 관리자</span>
          <span className="text-gray-300">|</span>
          <span className="text-sm text-gray-600">상품 관리</span>
        </div>
        <div className="flex items-center gap-4">
          {isSuper && (
            <a href="/admin/accounts" className="text-sm text-purple-500 hover:text-purple-400 font-semibold transition-colors">
              👑 계정 관리
            </a>
          )}
          <a href="/admin/orders" className="text-sm text-gray-500 hover:text-gray-700 font-medium transition-colors">
              📋 주문 관리
            </a>
          <a href="/admin/chat" className="text-sm text-gray-500 hover:text-gray-700 font-medium transition-colors">
            💬 채팅 상담
          </a>
          <a href="/" target="_blank" rel="noopener noreferrer" className="text-sm text-orange-500 hover:text-orange-600 font-semibold transition-colors">
            📺 라이브 보기 →
          </a>
          <button
            onClick={handleLogout}
            className="text-sm text-gray-400 hover:text-red-500 transition-colors font-medium"
          >
            로그아웃
          </button>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-5 gap-8">

        {/* ── LEFT: Form ── */}
        <div className="lg:col-span-2" ref={formRef}>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden sticky top-20">
            {/* Form header */}
            <div className={`px-5 py-4 ${editingId ? 'bg-gradient-to-r from-blue-500 to-indigo-600' : 'bg-gradient-to-r from-orange-500 to-red-500'}`}>
              <div className="flex items-center justify-between">
                <h2 className="text-white font-bold text-base">
                  {editingId ? '✏️ 상품 수정 중' : '+ 새 상품 등록'}
                </h2>
                {editingId && (
                  <button
                    type="button"
                    onClick={cancelEdit}
                    className="text-white/80 hover:text-white text-sm font-semibold transition-colors"
                  >
                    취소 ×
                  </button>
                )}
              </div>
              {editingId && (
                <p className="text-white/70 text-xs mt-0.5">수정 후 [수정 완료] 버튼을 클릭하세요</p>
              )}
            </div>

            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              {/* Product Name */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  상품명 <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  placeholder="ex) 스테인리스 냄비 세트 5종"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent transition"
                />
              </div>

              {/* Image Upload */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  상품 이미지 <span className="text-gray-400 font-normal">(선택)</span>
                </label>

                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />

                {!fileName && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full border-2 border-dashed border-orange-300 rounded-xl py-3 px-4 text-sm text-orange-500 hover:bg-orange-50 active:scale-[0.99] transition-all flex items-center justify-center gap-2 font-medium"
                  >
                    📁 컴퓨터에서 이미지 선택
                  </button>
                )}

                {fileName && (
                  <div className="flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-xl px-3 py-2 text-sm">
                    <span className="text-orange-500 font-medium flex-1 truncate">✓ {fileName}</span>
                    <button type="button" onClick={clearImage} className="text-red-400 hover:text-red-600 font-bold text-base leading-none flex-shrink-0">×</button>
                  </div>
                )}

                {!fileName && (
                  <>
                    <div className="flex items-center gap-2 my-2">
                      <div className="flex-1 h-px bg-gray-200" />
                      <span className="text-[10px] text-gray-400 font-medium whitespace-nowrap">또는 URL 입력</span>
                      <div className="flex-1 h-px bg-gray-200" />
                    </div>
                    <input
                      type="url"
                      placeholder="https://..."
                      value={form.imageUrl}
                      onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent transition"
                    />
                  </>
                )}

                {form.imageUrl && (
                  <div className="relative mt-2">
                    <img
                      src={form.imageUrl}
                      alt="preview"
                      className="h-28 w-full object-cover rounded-xl border border-gray-200"
                      onError={(e) => (e.currentTarget.style.display = 'none')}
                    />
                    <button
                      type="button"
                      onClick={clearImage}
                      className="absolute top-1.5 right-1.5 w-6 h-6 bg-red-500 hover:bg-red-600 text-white rounded-full text-xs font-bold flex items-center justify-center shadow"
                    >
                      ×
                    </button>
                  </div>
                )}
              </div>

              {/* Prices */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">
                    정상가 (₩) <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="number"
                    placeholder="89000"
                    value={form.originalPrice}
                    onChange={(e) => setForm({ ...form, originalPrice: e.target.value })}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">
                    라방특가 (₩) <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="number"
                    placeholder="35600"
                    value={form.livePrice}
                    onChange={(e) => setForm({ ...form, livePrice: e.target.value })}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent transition"
                  />
                </div>
              </div>

              {discountPct !== null && discountPct > 0 && (
                <div className="text-xs text-orange-600 font-bold bg-orange-50 rounded-lg px-3 py-1.5">
                  자동 할인율: {discountPct}% OFF
                </div>
              )}

              {/* Quantity */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  판매 수량 <span className="text-red-400">*</span>
                </label>
                <input
                  type="number"
                  placeholder="15"
                  min={1}
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent transition"
                />
              </div>

              {/* Specs */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">상세 사양</label>
                <textarea
                  rows={4}
                  placeholder={'재질: 316L 스테인리스\n인덕션 호환\n구성: 5종 세트'}
                  value={form.specs}
                  onChange={(e) => setForm({ ...form, specs: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent transition resize-none"
                />
              </div>

              <div className="flex gap-2">
                {editingId && (
                  <button
                    type="button"
                    onClick={cancelEdit}
                    className="flex-1 bg-gray-100 text-gray-600 font-bold py-3 rounded-xl hover:bg-gray-200 active:scale-95 transition-all"
                  >
                    취소
                  </button>
                )}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className={`font-bold py-3 rounded-xl hover:opacity-90 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-white ${editingId ? 'flex-1' : 'w-full'}`}
                  style={{ background: editingId ? 'linear-gradient(135deg,#3b82f6,#6366f1)' : 'linear-gradient(135deg,#ff6a00,#e53935)' }}
                >
                  {isSubmitting
                    ? (editingId ? '수정 중...' : '등록 중...')
                    : (editingId ? '✅ 수정 완료' : '+ 상품 등록')}
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* ── RIGHT: Product List ── */}
        <div className="lg:col-span-3 space-y-4">

          {/* Live status banner */}
          <div className={`rounded-2xl border-2 p-4 transition-all ${activeIds.length > 0 ? 'bg-red-50 border-red-400' : 'bg-gray-100 border-gray-300'}`}>
            {activeIds.length > 0 ? (
              <>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="live-pulse inline-block w-2 h-2 bg-red-500 rounded-full" />
                    <span className="text-xs font-bold text-red-600">
                      {activeIds.length}개 송출 중
                    </span>
                  </div>
                  <button
                    onClick={handleStopAll}
                    className="text-xs bg-white border border-red-300 text-red-500 hover:bg-red-50 font-semibold px-3 py-1.5 rounded-lg transition-colors"
                  >
                    ■ 전체 중단
                  </button>
                </div>
                <div className="space-y-1">
                  {activeProducts.map(p => (
                    <div key={p.id} className="flex items-center gap-2 text-xs">
                      <span className="inline-block w-1.5 h-1.5 bg-red-400 rounded-full flex-shrink-0" />
                      <span className="font-semibold text-gray-800 truncate flex-1">{p.name}</span>
                      <span className="text-gray-400 flex-shrink-0">₩{p.livePrice.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm font-semibold text-gray-500">현재 송출 중인 상품 없음</p>
            )}
          </div>

          {/* Product cards */}
          {products.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-sm">
              등록된 상품이 없습니다.<br />왼쪽 폼에서 첫 상품을 등록해보세요!
            </div>
          ) : products.map(product => {
            const isActive = activeIds.includes(product.id)
            const isEditing = product.id === editingId
            const discount = Math.round((1 - product.livePrice / product.originalPrice) * 100)
            return (
              <div
                key={product.id}
                className={`bg-white rounded-2xl border-2 transition-all duration-300 overflow-hidden shadow-sm ${
                  isEditing
                    ? 'border-blue-400 shadow-blue-100 shadow-md'
                    : isActive
                      ? 'border-red-400 shadow-red-100 shadow-md'
                      : 'border-gray-200 hover:border-orange-200'
                }`}
              >
                <div className="flex items-stretch">
                  {/* Thumbnail */}
                  <div className="w-24 flex-shrink-0 bg-orange-50 flex items-center justify-center overflow-hidden">
                    {product.imageUrl ? (
                      <img src={product.imageUrl} alt={product.name} loading="lazy" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-4xl">🍳</span>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 px-4 py-3 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                      {isActive && (
                        <span className="inline-flex items-center gap-1 text-[10px] bg-red-500 text-white font-bold px-2 py-0.5 rounded-full">
                          <span className="live-pulse inline-block w-1.5 h-1.5 bg-white rounded-full" />LIVE
                        </span>
                      )}
                      {isEditing && (
                        <span className="text-[10px] bg-blue-500 text-white font-bold px-2 py-0.5 rounded-full">수정 중</span>
                      )}
                    </div>
                    <h3 className="font-bold text-gray-900 text-sm leading-tight truncate">{product.name}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-red-500 font-extrabold text-sm">₩{product.livePrice.toLocaleString()}</span>
                      <span className="text-gray-400 line-through text-xs">₩{product.originalPrice.toLocaleString()}</span>
                      <span className="text-[10px] bg-red-100 text-red-600 font-bold px-1.5 py-0.5 rounded">{discount}%</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                      <span>📦 {product.quantity}개</span>
                      <span className="text-gray-300">|</span>
                      <span>{new Date(product.createdAt).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col justify-center gap-1.5 px-3 py-3 border-l border-gray-100">
                    {isActive ? (
                      <button
                        onClick={() => handleStopLive(product.id)}
                        className="text-xs bg-gray-100 text-gray-600 hover:bg-gray-200 font-semibold px-3 py-2 rounded-xl transition-colors whitespace-nowrap"
                      >
                        ■ 중단
                      </button>
                    ) : (
                      <button
                        onClick={() => handleSetLive(product.id)}
                        disabled={livingId === product.id}
                        className="text-xs text-white font-bold px-3 py-2 rounded-xl transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                        style={{ background: 'linear-gradient(135deg,#ff6a00,#e53935)' }}
                      >
                        {livingId === product.id ? '...' : '▶ LIVE'}
                      </button>
                    )}
                    <button
                      onClick={() => startEdit(product)}
                      className={`text-xs font-semibold px-3 py-2 rounded-xl transition-colors whitespace-nowrap ${
                        isEditing
                          ? 'bg-blue-500 text-white'
                          : 'bg-white border border-blue-200 text-blue-500 hover:bg-blue-50'
                      }`}
                    >
                      ✏️ 수정
                    </button>
                    <button
                      onClick={() => handleDelete(product.id)}
                      disabled={deletingId === product.id}
                      className="text-xs bg-white border border-gray-200 text-gray-400 hover:text-red-500 hover:border-red-300 font-semibold px-3 py-2 rounded-xl transition-colors disabled:opacity-50"
                    >
                      삭제
                    </button>
                  </div>
                </div>

                {product.specs && (
                  <div className="px-4 pb-3 border-t border-gray-100">
                    <p className="text-xs text-gray-500 whitespace-pre-line leading-relaxed pt-2">{product.specs}</p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Toast ── */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-2xl text-white text-sm font-semibold shadow-xl z-50 ${toast.type === 'error' ? 'bg-red-500' : 'bg-gray-900'}`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
