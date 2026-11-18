'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { ORDER_WORKBOOK_MIME } from '@/lib/order-workbook'
import { buildOrderWorkbook } from '@/lib/commerce/order-export'
import { orderItemLabel, PAYMENT_LABELS, ORDER_STATUSES, type AdminOrder, type AdminOrderItem, type AdminOrderWithItems } from '@/lib/commerce/admin-orders'
import AdminOrderEditor from '@/app/components/commerce/AdminOrderEditor'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

type OrderWithItems = AdminOrderWithItems

const STATUS_LIST = ORDER_STATUSES

const STATUS_STYLE: Record<string, string> = {
  '입금대기': 'bg-amber-100 text-amber-700 border-amber-300',
  '결제대기': 'bg-orange-100 text-orange-700 border-orange-300',
  '결제완료': 'bg-green-100 text-green-700 border-green-300',
  '배송중':   'bg-blue-100  text-blue-700  border-blue-300',
  '배송완료': 'bg-gray-100  text-gray-600  border-gray-300',
}

// 삭제 보관 기간(일). 이 기간이 지난 삭제 주문은 관리자 접속 시 자동 영구삭제됩니다.
const RETENTION_DAYS = 30
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000

// 삭제 후 남은 보관 일수
function daysLeft(deletedAt: string): number {
  const elapsed = Date.now() - new Date(deletedAt).getTime()
  return Math.max(0, Math.ceil((RETENTION_MS - elapsed) / (24 * 60 * 60 * 1000)))
}

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<OrderWithItems[]>([])
  const [loading, setLoading] = useState(true)
  const [showTrash, setShowTrash] = useState(false)
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set())
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ name: string; total: number } | null>(null)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [commerceEnabled, setCommerceEnabled] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const commerceRef = useRef(false), editingRef = useRef<string | null>(null), seenOrders = useRef<Set<string> | null>(null)
  commerceRef.current = commerceEnabled; editingRef.current = editingId
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const audioCtx = useRef<AudioContext | null>(null)

  const playAlert = useCallback(() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Ctx = window.AudioContext || (window as any).webkitAudioContext
      if (!audioCtx.current) audioCtx.current = new Ctx()
      const ctx = audioCtx.current
      if (ctx.state === 'suspended') ctx.resume()
      ;[880, 1100, 1320].forEach((freq, i) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        const t = ctx.currentTime + i * 0.18
        osc.type = 'sine'
        osc.frequency.value = freq
        gain.gain.setValueAtTime(0, t)
        gain.gain.linearRampToValueAtTime(0.4, t + 0.01)
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4)
        osc.connect(gain); gain.connect(ctx.destination)
        osc.start(t); osc.stop(t + 0.45)
      })
    } catch { /* AudioContext blocked — silent fail */ }
  }, [])

  const showToast = useCallback((name: string, total: number) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ name, total })
    toastTimer.current = setTimeout(() => setToast(null), 6000)
  }, [])

  const fetchOrders = useCallback(async (background = false) => {
    if (!background) setLoading(true)
    try {
      const response = await fetch('/api/admin/orders', { cache: 'no-store' })
      if (!response.ok) throw new Error('주문을 불러오지 못했습니다. 로그인 상태와 연결을 확인한 뒤 다시 시도해 주세요.')
      const payload = await response.json() as { orders?: OrderWithItems[]; commerceEnabled?: boolean; hasMore?: boolean }
      const merged = payload.orders ?? []
      setCommerceEnabled(payload.commerceEnabled === true); setHasMore(payload.hasMore === true); setLoadError('')
      let retained = merged
      if (!payload.commerceEnabled) {
        const expired = merged.filter(o => o.commerce_version === undefined && o.deleted_at && new Date(o.deleted_at).getTime() < Date.now() - RETENTION_MS)
        const removed = new Set<string>()
        for (const order of expired) {
          const itemsResult = await db.from('order_items').delete().eq('order_id', order.id)
          if (itemsResult.error) continue
          const result = await db.from('orders').delete().eq('id', order.id)
          if (!result.error) removed.add(order.id)
        }
        retained = merged.filter(o => !removed.has(o.id))
      }
      if (seenOrders.current) {
        const fresh = retained.filter(o => !seenOrders.current!.has(o.id) && !o.deleted_at)
        if (background && fresh.length) { playAlert(); showToast(fresh[0].customer_name, fresh[0].total_price) }
      }
      seenOrders.current = new Set(retained.map(o => o.id))
      setOrders(retained)
    } catch (error) { setLoadError(error instanceof Error ? error.message : '주문 정보를 불러오지 못했습니다.') }
    finally { if (!background) setLoading(false) }
  }, [playAlert, showToast])

  useEffect(() => {
    fetchOrders()

    const channel = supabase
      .channel('admin-orders-notify')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, async (payload) => {
        if (commerceRef.current) { void fetchOrders(true); return }
        const newOrder = payload.new as AdminOrder
        let items: AdminOrderItem[] = []
        for (let attempt = 0; attempt < 3 && items.length === 0; attempt += 1) {
          if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 250 * attempt))
          const { data } = await db.from('order_items').select('*').eq('order_id', newOrder.id)
          items = (data ?? []) as AdminOrderItem[]
        }
        const full: OrderWithItems = { ...newOrder, items }
        seenOrders.current?.add(newOrder.id)
        setOrders(prev => [full, ...prev.filter(order => order.id !== newOrder.id)])
        playAlert()
        showToast(newOrder.customer_name, newOrder.total_price)
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [fetchOrders, playAlert, showToast])

  useEffect(() => {
    const timer = setInterval(() => { if (commerceRef.current && !editingRef.current && document.visibilityState === 'visible') void fetchOrders(true) }, 30000)
    return () => { clearInterval(timer); if (toastTimer.current) clearTimeout(toastTimer.current) }
  }, [fetchOrders])

  async function serverChange(orderId: string, path: string, payload: Record<string, unknown>) {
    const response = await fetch('/api/admin/orders/' + orderId + path, { method: path ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? '주문 변경에 실패했습니다.')
    await fetchOrders(true)
  }
  async function updateStatus(orderId: string, status: string) {
    const order = orders.find(o => o.id === orderId)
    if (!order) return
    setUpdatingId(orderId); setActionError('')
    try {
      if (commerceEnabled) await serverChange(orderId, '', { version: order.version ?? 1, status })
      else { const result = await db.from('orders').update({ status }).eq('id', orderId); if (result.error) throw new Error(result.error.message); setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status } : o)) }
    } catch (error) { setActionError(error instanceof Error ? error.message : '상태 변경에 실패했습니다.') }
    finally { setUpdatingId(null) }
  }

  function toggleOrderSelection(orderId: string) {
    setSelectedOrderIds(prev => {
      const next = new Set(prev)
      if (next.has(orderId)) next.delete(orderId)
      else next.add(orderId)
      return next
    })
  }

  function toggleAllDisplayedOrders() {
    setSelectedOrderIds(prev => {
      const displayIds = displayOrders.map(order => order.id)
      const allSelected = displayIds.length > 0 && displayIds.every(id => prev.has(id))
      const next = new Set(prev)

      if (allSelected) displayIds.forEach(id => next.delete(id))
      else displayIds.forEach(id => next.add(id))

      return next
    })
  }

  async function deleteOrder(orderId: string) {
    const order = orders.find(o => o.id === orderId)
    if (!order || !confirm(commerceEnabled ? '이 주문을 보관함으로 이동할까요? 주문·재고 이력은 유지됩니다.' : '이 주문을 삭제하시겠습니까? 보관함에서 30일간 복원할 수 있습니다.')) return
    setActionError('')
    try {
      if (commerceEnabled) await serverChange(orderId, '/archive', { version: order.version ?? 1, archived: true })
      else { const ts = new Date().toISOString(); const result = await db.from('orders').update({ deleted_at: ts }).eq('id', orderId); if (result.error) throw new Error(result.error.message); setOrders(prev => prev.map(o => o.id === orderId ? { ...o, deleted_at: ts } : o)) }
      setSelectedOrderIds(prev => { const next = new Set(prev); next.delete(orderId); return next })
    } catch (error) { setActionError(error instanceof Error ? error.message : '보관에 실패했습니다.') }
  }
  async function restoreOrder(orderId: string) {
    const order = orders.find(o => o.id === orderId)
    if (!order) return
    setActionError('')
    try {
      if (commerceEnabled) await serverChange(orderId, '/archive', { version: order.version ?? 1, archived: false })
      else { const result = await db.from('orders').update({ deleted_at: null }).eq('id', orderId); if (result.error) throw new Error(result.error.message); setOrders(prev => prev.map(o => o.id === orderId ? { ...o, deleted_at: null } : o)) }
    } catch (error) { setActionError(error instanceof Error ? error.message : '복원에 실패했습니다.') }
  }
  async function purgeOrder(orderId: string) {
    if (commerceEnabled || orders.find(o => o.id === orderId)?.commerce_version !== undefined) { setActionError('서버에서 관리하는 주문은 이력을 보존합니다. 보관 기능을 사용해 주세요.'); return }
    if (!confirm('이 주문을 완전히 삭제할까요? 복원할 수 없습니다.')) return
    setActionError('')
    try {
      const items = await db.from('order_items').delete().eq('order_id', orderId); if (items.error) throw new Error(items.error.message)
      const result = await db.from('orders').delete().eq('id', orderId); if (result.error) throw new Error(result.error.message)
      setOrders(prev => prev.filter(o => o.id !== orderId))
      setSelectedOrderIds(prev => { const next = new Set(prev); next.delete(orderId); return next })
    } catch (error) { setActionError(error instanceof Error ? error.message : '삭제에 실패했습니다.') }
  }

  async function handleLogout() {
    await fetch('/api/admin/logout', { method: 'POST' })
    window.location.href = '/admin/login'
  }

  async function downloadOrderSheet() {
    if (!selectedDisplayOrders.length || exporting) return
    setExporting(true); setActionError('')
    try {
      let exported = selectedDisplayOrders
      if (commerceEnabled) {
        const response = await fetch('/api/admin/orders/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderIds: selectedDisplayOrders.map(o => o.id) }) })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error ?? '최신 발주서 정보를 불러오지 못했습니다.')
        exported = data.orders
      }
      const blob = new Blob([buildOrderWorkbook(exported)], { type: ORDER_WORKBOOK_MIME })
      const url = URL.createObjectURL(blob), link = document.createElement('a')
      link.href = url; link.download = '발주서-' + new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }) + '.xlsx'
      document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) { setActionError(error instanceof Error ? error.message : '발주서를 만들지 못했습니다.') }
    finally { setExporting(false) }
  }

  const activeOrders  = orders.filter(o => !o.deleted_at)
  const trashedOrders = orders.filter(o => o.deleted_at)
  const displayOrders = showTrash ? trashedOrders : activeOrders
  const selectedDisplayOrders = displayOrders.filter(o => selectedOrderIds.has(o.id))
  const allDisplayedSelected = displayOrders.length > 0 && displayOrders.every(o => selectedOrderIds.has(o.id))
  const totalRevenue = activeOrders.filter(o => o.status !== '취소').reduce((s, o) => s + o.total_price, 0)
  const pending = activeOrders.filter(o => o.status === '입금대기' || o.status === '결제대기').length

  return (
    <div className="min-h-screen-safe bg-gray-50">

      {/* ── Nav ── */}
      <nav className="bg-white border-b border-gray-200 px-4 py-3 flex flex-wrap gap-3 items-center justify-between sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="text-xl font-black text-gray-900">🛠 관리자</span>
          <span className="text-gray-300">|</span>
          <span className="text-sm text-gray-600 font-semibold">주문 관리</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <a href="/admin/products" className="text-sm text-gray-500 hover:text-gray-700 font-medium transition-colors">📦 상품</a>
          <a href="/admin/chat" className="text-sm text-gray-500 hover:text-gray-700 font-medium transition-colors">💬 채팅</a>
          <a href="/admin/qr" className="text-sm text-gray-500 hover:text-gray-700 font-medium transition-colors">📱 QR</a>
          <a href="/admin/toss" className="text-sm text-gray-500 hover:text-gray-700 font-medium transition-colors">💳 토스 준비</a>
          <a href="/" target="_blank" rel="noopener noreferrer" className="text-sm text-orange-500 hover:text-orange-600 font-semibold transition-colors">📺 라이브 →</a>
          <button onClick={handleLogout} className="text-sm text-gray-400 hover:text-red-500 transition-colors font-medium">로그아웃</button>
        </div>
      </nav>

      {/* ── New Order Toast ── */}
      {toast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-green-600 text-white px-5 py-3 rounded-2xl shadow-2xl animate-fade-in">
          <span className="text-xl">🛎</span>
          <div>
            <p className="text-sm font-black">새 주문이 들어왔습니다!</p>
            <p className="text-xs opacity-90">{toast.name} · ₩{toast.total.toLocaleString()}</p>
          </div>
          <button onClick={() => setToast(null)} className="ml-2 text-white/70 hover:text-white text-lg leading-none">×</button>
        </div>
      )}

      {editingId && <AdminOrderEditor orderId={editingId} onClose={() => setEditingId(null)} onSaved={() => { void fetchOrders(true) }} />}
      <div className="max-w-5xl mx-auto px-4 py-6">

        {/* ── Stats ── */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: '조회한 주문', value: `${activeOrders.length}건`, color: 'text-gray-900' },
            { label: '입금 대기', value: `${pending}건`, color: 'text-amber-600' },
            { label: '조회 주문금액', value: `₩${totalRevenue.toLocaleString()}`, color: 'text-red-500' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-2xl border border-gray-200 p-4 text-center shadow-sm">
              <p className="text-xs text-gray-400 font-medium mb-1">{s.label}</p>
              <p className={`text-xl font-black ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* ── Header row ── */}
        <div className="flex flex-wrap gap-3 items-center justify-between mb-3">
          <h2 className="text-sm font-extrabold text-gray-700">
            {showTrash ? (commerceEnabled ? '주문 보관함 (이력 유지)' : `🗑 삭제 보관함 (${RETENTION_DAYS}일 보관)`) : '주문 목록 (최신순)'}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                setShowTrash(v => !v)
                setSelectedOrderIds(new Set())
              }}
              className={`text-xs font-bold border rounded-lg px-3 py-1.5 transition-colors ${
                showTrash
                  ? 'text-gray-600 border-gray-300 hover:bg-gray-100'
                  : 'text-gray-500 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {showTrash ? '← 주문 목록' : `🗑 보관함${trashedOrders.length > 0 ? ` (${trashedOrders.length})` : ''}`}
            </button>
            <label className="flex items-center gap-1.5 text-xs font-bold text-gray-500 border border-gray-200 rounded-lg px-3 py-1.5 bg-white">
              <input
                type="checkbox"
                checked={allDisplayedSelected}
                disabled={displayOrders.length === 0}
                onChange={toggleAllDisplayedOrders}
                className="h-3.5 w-3.5 accent-green-600 disabled:opacity-40"
              />
              전체선택
            </label>
            <button
              onClick={downloadOrderSheet}
              disabled={selectedDisplayOrders.length === 0 || exporting}
              className="text-xs text-green-600 hover:text-green-700 font-bold border border-green-200 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              발주서 다운로드 ({selectedDisplayOrders.length})
            </button>
            <button
              onClick={() => void fetchOrders()}
              className="text-xs text-orange-500 hover:text-orange-600 font-bold border border-orange-200 rounded-lg px-3 py-1.5 transition-colors"
            >
              ↻ 새로고침
            </button>
          </div>
        </div>

        {hasMore && <p className="mb-3 text-xs text-gray-500">최근 500건을 조회하고 있습니다. 통계와 발주서는 조회한 주문을 기준으로 합니다.</p>}
        {(actionError || loadError) && <p role="alert" className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{actionError || loadError}</p>}
        {/* ── Order list ── */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-10 h-10 rounded-full border-4 border-orange-200 border-t-orange-500 animate-spin" />
          </div>
        ) : displayOrders.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 py-20 text-center text-gray-400">
            <p className="text-4xl mb-3">{loadError ? '⚠️' : showTrash ? '🗑' : '📭'}</p>
            <p className="font-semibold">{loadError || (showTrash ? '삭제된 주문이 없습니다.' : '아직 접수된 주문이 없습니다.')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {displayOrders.map(order => (
              <div key={order.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">

                {/* Order header */}
                <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={selectedOrderIds.has(order.id)}
                      onChange={() => toggleOrderSelection(order.id)}
                      aria-label={`${order.customer_name} 주문 선택`}
                      className="h-4 w-4 accent-green-600"
                    />
                    <span className="text-xs font-black text-gray-500">#{order.id.slice(0, 8).toUpperCase()}</span>
                    <span className="text-xs text-gray-400">
                      {new Date(order.created_at).toLocaleString('ko-KR', {
                        month: 'short', day: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                    {showTrash && order.deleted_at && (
                      <span className="text-[11px] font-bold text-red-500 bg-red-50 border border-red-200 rounded-md px-2 py-0.5">
                        {commerceEnabled ? '주문·재고 이력 보존' : `${daysLeft(order.deleted_at)}일 후 영구삭제`}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {showTrash ? (
                      <>
                        <button
                          onClick={() => restoreOrder(order.id)}
                          className="text-xs font-bold text-green-600 hover:text-green-700 border border-green-200 hover:border-green-400 rounded-lg px-2.5 py-1.5 transition-colors"
                        >
                          ↩ 복원
                        </button>
                        <button
                          disabled={commerceEnabled || order.commerce_version !== undefined}
                          onClick={() => purgeOrder(order.id)}
                          className="text-xs font-bold text-red-500 hover:text-white hover:bg-red-500 border border-red-300 rounded-lg px-2.5 py-1.5 transition-colors"
                        >
                          {commerceEnabled ? '이력 보존' : '영구삭제'}
                        </button>
                      </>
                    ) : (
                      <>
                        {commerceEnabled && <button type="button" onClick={() => setEditingId(order.id)} className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-bold text-blue-700">상세·수정</button>}
                        {/* Status select */}
                        <select
                          value={order.status}
                          disabled={updatingId === order.id || (order.commerce_version === 2 && (order.inventory_state === 'released' || ['confirming', 'payment_review'].includes(order.payment_status ?? '')))}
                          onChange={e => updateStatus(order.id, e.target.value)}
                          className={`text-xs font-bold border rounded-lg px-2.5 py-1.5 cursor-pointer focus:outline-none focus:ring-2 focus:ring-orange-300 transition-all disabled:opacity-60 ${STATUS_STYLE[order.status] ?? 'bg-gray-100 text-gray-600 border-gray-300'}`}
                        >
                          {STATUS_LIST.map(s => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                        {/* Delete button */}
                        <button
                          onClick={() => deleteOrder(order.id)}
                          className="text-xs font-bold text-red-400 hover:text-red-600 border border-red-200 hover:border-red-400 rounded-lg px-2.5 py-1.5 transition-colors"
                        >
                          {commerceEnabled ? '보관' : '삭제'}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="px-5 py-4 grid grid-cols-1 md:grid-cols-2 gap-4">

                  {/* Customer info */}
                  <div className="space-y-1.5">
                    <div className="flex items-start gap-2">
                      <span className="text-[11px] font-bold text-gray-400 w-14 flex-shrink-0 mt-0.5">주문자</span>
                      <span className="text-sm font-bold text-gray-900">{order.customer_name}</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-[11px] font-bold text-gray-400 w-14 flex-shrink-0 mt-0.5">연락처</span>
                      <span className="text-sm text-gray-700">{order.recipient_phone ?? order.customer_phone}</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-[11px] font-bold text-gray-400 w-14 flex-shrink-0 mt-0.5">주소</span>
                      <span className="text-sm text-gray-700 leading-snug">{order.recipient_address ?? order.customer_address}</span>
                    </div>
                    <div className="flex items-start gap-2"><span className="mt-0.5 w-14 shrink-0 text-[11px] font-bold text-gray-400">수령인</span><span className="text-sm font-semibold">{order.recipient_name ?? order.customer_name}</span></div>
                    {commerceEnabled && <div className="space-y-1 rounded-xl bg-gray-50 p-3 text-xs"><p>결제 방식: {order.payment_method === 'bank' ? '계좌이체' : order.payment_method === 'card' ? '카드·간편결제' : order.payment_method || '기존 주문 기록'}</p><p>결제 상태: {order.commerce_version !== 2 && order.payment_amount == null ? `기존 기록 (${order.status})` : PAYMENT_LABELS[order.payment_status ?? 'pending'] ?? order.payment_status}</p><p>{order.payment_amount == null ? '실제 결제액 미등록' : `실제 결제액: ${order.payment_amount.toLocaleString()}원`}</p>{order.admin_memo && <p className="whitespace-pre-wrap">관리자 메모: {order.admin_memo}</p>}</div>}
                    {(() => {
                      const raw = order.customer_request ?? ''
                      const parts = raw.split(' | ')
                      const payPart = order.commerce_version === 2 ? '' : parts.find(p => p.startsWith('[')) ?? ''
                      const reqPart = order.commerce_version === 2 ? raw : parts.filter(p => !p.startsWith('[')).join(' | ').trim()
                      const payText = payPart.replace(/^\[|\]$/g, '')
                      const isCard = payText.startsWith('카드결제')
                      return (
                        <>
                          {payText && (
                            <div className="flex items-start gap-2">
                              <span className="text-[11px] font-bold text-gray-400 w-14 flex-shrink-0 mt-0.5">결제</span>
                              <span className={`text-sm font-bold ${isCard ? 'text-blue-600 select-all' : 'text-gray-700'}`}>{payText}</span>
                            </div>
                          )}
                          {reqPart && (
                            <div className="flex items-start gap-2">
                              <span className="text-[11px] font-bold text-gray-400 w-14 flex-shrink-0 mt-0.5">요청</span>
                              <span className="text-sm text-gray-500 italic">{reqPart}</span>
                            </div>
                          )}
                        </>
                      )
                    })()}
                  </div>

                  {/* Items */}
                  <div>
                    <p className="text-[11px] font-bold text-gray-400 mb-2">주문 상품</p>
                    <div className="space-y-1">
                      {order.items.map(item => (
                        <div key={item.id} className="flex justify-between text-sm">
                          <span className="text-gray-700 flex-1 min-w-0 break-words mr-2">{orderItemLabel(item, order.items)} × {item.quantity}</span>
                          <span className="font-bold text-gray-900 flex-shrink-0">₩{(item.price * item.quantity).toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                    <div className="border-t border-gray-100 mt-2 pt-2 flex justify-between">
                      <span className="text-sm font-bold text-gray-600">합계</span>
                      <span className="font-black text-red-500">₩{order.total_price.toLocaleString()}</span>
                    </div>
                  </div>

                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
