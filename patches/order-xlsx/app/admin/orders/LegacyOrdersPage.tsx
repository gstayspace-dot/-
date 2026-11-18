'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { RECEIPT_STATUS, type ReceiptSummary } from '@/lib/receipt-types'
import { createOrderWorkbook, orderWorkbookRow, ORDER_WORKBOOK_MIME } from '@/lib/order-workbook'
import SupplierOrderExport from './SupplierOrderExport'
import ShippingBreakdown from '@/app/components/ShippingBreakdown'
import OrderEntry from './OrderEntry'
import OrderEditor from './OrderEditor'
import { supabase, type DbOrder, type DbOrderItem } from '@/lib/supabaseClient'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

type OrderWithItems = DbOrder & { items: DbOrderItem[]; cash_receipt?: ReceiptSummary | null }

const STATUS_LIST = ['입금대기', '결제대기', '결제완료', '배송중', '배송완료', '결제취소', '환불확인필요', '결제요청실패'] as const

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

function buildLegacyOrderWorkbook(orders: OrderWithItems[]): ArrayBuffer {
  const rows = orders.flatMap(order => {
    const items = order.items.length ? order.items : [{ product_name: '', quantity: 0 }]
    return items.map(item => orderWorkbookRow(order, item.product_name, item.quantity))
  })
  return createOrderWorkbook([{ name: '발주서', rows }])
}

export default function AdminOrdersPage() {
  const [editingOrder, setEditingOrder] = useState<OrderWithItems | null>(null)
  const [orders, setOrders] = useState<OrderWithItems[]>([])
  const [loading, setLoading] = useState(true)
  const [showTrash, setShowTrash] = useState(false)
  const [orderPage, setOrderPage] = useState(1)
  useEffect(() => { setOrderPage(1) }, [showTrash])
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set())
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [loadError, setLoadError] = useState('')
  const [toast, setToast] = useState<{ name: string; total: number } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const audioCtx = useRef<AudioContext | null>(null)

  function playAlert() {
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
  }

  function showToast(name: string, total: number) {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ name, total })
    toastTimer.current = setTimeout(() => setToast(null), 6000)
  }

  const fetchingOrders = useRef(false)
  const fetchOrders = useCallback(async (options?: { quiet: boolean }) => {
    if (fetchingOrders.current) return
    fetchingOrders.current = true
    try {
    if (!options?.quiet) setLoading(true)
    setLoadError('')

    const fetchStarted = Date.now()
    const res = await fetch('/api/admin/orders', {
      cache: 'no-store',
      credentials: 'same-origin',
    })
    const data = await res.json().catch(() => null) as { orders?: OrderWithItems[]; error?: string; receiptWarning?: string } | null

    if (!res.ok || !Array.isArray(data?.orders)) {
      setLoadError(data?.error ?? '주문 목록을 불러오지 못했습니다.')
      setLoading(false)
      return
    }

    if (data.receiptWarning) setLoadError(data.receiptWarning)
    const merged = data.orders

    // 30일 지난 삭제 주문 자동 영구삭제 (deleted_at 컬럼이 없으면 모두 통과 → no-op)
    const cutoff = Date.now() - RETENTION_MS
    const expired = merged.filter(o => o.deleted_at && new Date(o.deleted_at).getTime() < cutoff)
    if (expired.length > 0) {
      const ids = expired.map(o => o.id)
      await db.from('order_items').delete().in('order_id', ids)
      await db.from('orders').delete().in('id', ids)
    }
    const expiredSet = new Set(expired.map(o => o.id))
    setOrders(prev => {
      const saved = merged.filter(o => !expiredSet.has(o.id))
      const ids = new Set(saved.map(o => o.id))
      return [...prev.filter(o => !ids.has(o.id) && new Date(o.created_at).getTime() >= fetchStarted), ...saved]
    })
    setLoading(false)
    } catch {
      setLoadError('주문 목록을 불러오지 못했습니다. 다시 시도해주세요.')
    } finally {
      fetchingOrders.current = false
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchOrders()

    const channel = supabase
      .channel('admin-orders-notify')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, async (payload) => {
        const newOrder = payload.new as DbOrder
        let items: DbOrderItem[] = []

        for (let attempt = 0; attempt < 5; attempt += 1) {
          await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 500 : 700))
          const { data } = await db.from('order_items').select('*').eq('order_id', newOrder.id)
          items = (data ?? []) as DbOrderItem[]
          if (items.length > 0) break
        }

        const full: OrderWithItems = { ...newOrder, items }
        setOrders(prev => [full, ...prev.filter(order => order.id !== newOrder.id)])
        if (items.length === 0) window.setTimeout(fetchOrders, 1500)
        playAlert()
        showToast(newOrder.customer_name, newOrder.total_price)
      })
      .subscribe()

    const refresh = () => { void fetchOrders({ quiet: true }) }
    window.addEventListener('focus', refresh)
    const timer = window.setInterval(refresh, 60000)
    return () => { supabase.removeChannel(channel); window.removeEventListener('focus', refresh); window.clearInterval(timer) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchOrders])

async function updateStatus(orderId: string, status: string) {
    setUpdatingId(orderId)
    try {
      const res = await fetch('/api/admin/orders/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: orderId, status }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '주문 상태 저장에 실패했습니다.')
      await fetchOrders({ quiet: true })
      if (data.warning) setLoadError(data.warning)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '주문 상태 저장에 실패했습니다.')
    } finally {
      setUpdatingId(null)
    }
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

  // 소프트 삭제: 보관함으로 이동 (30일 후 자동 영구삭제)
  async function deleteOrder(orderId: string) {
    if (!confirm(`이 주문을 삭제하시겠습니까?\n삭제 보관함에서 ${RETENTION_DAYS}일간 복원할 수 있습니다.`)) return
    const ts = new Date().toISOString()
    await db.from('orders').update({ deleted_at: ts }).eq('id', orderId)
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, deleted_at: ts } : o))
    setSelectedOrderIds(prev => {
      const next = new Set(prev)
      next.delete(orderId)
      return next
    })
  }

  // 보관함에서 복원
  async function restoreOrder(orderId: string) {
    await db.from('orders').update({ deleted_at: null }).eq('id', orderId)
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, deleted_at: null } : o))
    setSelectedOrderIds(prev => {
      const next = new Set(prev)
      next.delete(orderId)
      return next
    })
  }

  // 영구 삭제 (복원 불가)
  async function purgeOrder(orderId: string) {
    if (!confirm('이 주문을 완전히 삭제할까요?\n복원할 수 없습니다.')) return
    await db.from('order_items').delete().eq('order_id', orderId)
    await db.from('orders').delete().eq('id', orderId)
    setOrders(prev => prev.filter(o => o.id !== orderId))
    setSelectedOrderIds(prev => {
      const next = new Set(prev)
      next.delete(orderId)
      return next
    })
  }

  async function handleLogout() {
    await fetch('/api/admin/logout', { method: 'POST' })
    window.location.href = '/admin/login'
  }

  function downloadOrderSheet() {
    const exportOrders = selectedDisplayOrders
    if (exportOrders.length === 0) {
      alert('엑셀로 다운로드할 주문을 먼저 체크해 주세요.')
      return
    }

    const blob = new Blob([buildLegacyOrderWorkbook(exportOrders)], { type: ORDER_WORKBOOK_MIME })
    const url = URL.createObjectURL(blob)
    const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)
    const a = document.createElement('a')
    a.href = url
    a.download = `발주서-${today}.xlsx`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const activeOrders  = orders.filter(o => !o.deleted_at)
  const trashedOrders = orders.filter(o => o.deleted_at)
  const displayOrders = showTrash ? trashedOrders : activeOrders
  const pageCount = Math.max(1, Math.ceil(displayOrders.length / 30))
  const currentPage = Math.min(orderPage, pageCount)
  const pageOrders = displayOrders.slice((currentPage - 1) * 30, currentPage * 30)
  const selectedDisplayOrders = displayOrders.filter(o => selectedOrderIds.has(o.id))
  const allDisplayedSelected = displayOrders.length > 0 && displayOrders.every(o => selectedOrderIds.has(o.id))
  const totalRevenue = activeOrders.reduce((s, o) => s + Number(o.total_price || 0), 0)
  const pending = activeOrders.filter(o => o.status === '입금대기' || o.status === '결제대기').length

  return (
    <div className="min-h-screen-safe bg-gray-50">

      {editingOrder && <OrderEditor order={editingOrder} onClose={() => setEditingOrder(null)} onSaved={() => { setEditingOrder(null); void fetchOrders({ quiet: true }) }} />}
      {/* ── Nav ── */}
      <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="text-xl font-black text-gray-900">🛠 관리자</span>
          <span className="text-gray-300">|</span>
          <span className="text-sm text-gray-600 font-semibold">주문 관리</span>
        </div>
        <div className="flex items-center gap-4">
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

      <div className="max-w-5xl mx-auto px-4 py-6">

        <SupplierOrderExport />
        <OrderEntry onCreated={() => { void fetchOrders() }} />

        {/* ── Stats ── */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: '전체 주문', value: `${activeOrders.length}건`, color: 'text-gray-900' },
            { label: '입금 대기', value: `${pending}건`, color: 'text-amber-600' },
            { label: '누적 매출', value: `₩${totalRevenue.toLocaleString()}`, color: 'text-red-500' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-2xl border border-gray-200 p-4 text-center shadow-sm">
              <p className="text-xs text-gray-400 font-medium mb-1">{s.label}</p>
              <p className={`text-xl font-black ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* ── Header row ── */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-extrabold text-gray-700">
            {showTrash ? `🗑 삭제 보관함 (${RETENTION_DAYS}일 보관)` : '주문 목록 (최신순)'}
          </h2>
          <div className="flex items-center gap-2">
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
              전체 주문 선택
            </label>
            <button
              onClick={downloadOrderSheet}
              disabled={selectedDisplayOrders.length === 0}
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

        {loadError && (
          <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">
            {loadError}
          </div>
        )}

        {!loading && displayOrders.length > 0 && <div className="mb-3 flex items-center justify-between gap-3 text-sm">
          <span>전체 {displayOrders.length}건 · {currentPage}/{pageCount} 페이지 (30건씩)</span>
          <div className="flex gap-2">
            <button disabled={currentPage === 1} onClick={() => setOrderPage(currentPage - 1)} className="rounded-lg border bg-white px-3 py-2 disabled:opacity-40">이전</button>
            <button disabled={currentPage === pageCount} onClick={() => setOrderPage(currentPage + 1)} className="rounded-lg border bg-white px-3 py-2 disabled:opacity-40">다음</button>
          </div>
        </div>}
        {/* ── Order list ── */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-10 h-10 rounded-full border-4 border-orange-200 border-t-orange-500 animate-spin" />
          </div>
        ) : displayOrders.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 py-20 text-center text-gray-400">
            <p className="text-4xl mb-3">{showTrash ? '🗑' : '📭'}</p>
            <p className="font-semibold">{showTrash ? '삭제된 주문이 없습니다.' : '아직 접수된 주문이 없습니다.'}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {pageOrders.map(order => (
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
                        {daysLeft(order.deleted_at)}일 후 영구삭제
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
                          onClick={() => purgeOrder(order.id)}
                          className="text-xs font-bold text-red-500 hover:text-white hover:bg-red-500 border border-red-300 rounded-lg px-2.5 py-1.5 transition-colors"
                        >
                          영구삭제
                        </button>
                      </>
                    ) : (
                      <>
                        {/* Status select */}
                        <select
                          value={order.status}
                          disabled={updatingId === order.id}
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
                          삭제
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
                      <span className="text-sm text-gray-700">{order.customer_phone}</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-[11px] font-bold text-gray-400 w-14 flex-shrink-0 mt-0.5">주소</span>
                      <span className="text-sm text-gray-700 leading-snug">{order.customer_address}</span>
                    </div>
                    {(() => {
                      const raw = order.customer_request ?? ''
                      const parts = raw.split(' | ')
                      const payPart = parts.find(p => p.startsWith('[')) ?? ''
                      const reqPart = parts.filter(p => !p.startsWith('[')).join(' | ').trim()
                      const payText = payPart.replace(/^\[|\]$/g, '')
                      const isCard = payText.startsWith('카드결제')
                      const displayedPayment = order.payment_method?.startsWith('PAYAPP:') ? `페이앱 · ${order.payment_method.slice(7)}` : payText
                      return (
                        <>
                          {payText && (
                            <div className="flex items-start gap-2">
                              <span className="text-[11px] font-bold text-gray-400 w-14 flex-shrink-0 mt-0.5">결제</span>
                              <span className={`text-sm font-bold ${isCard ? 'text-blue-600 select-all' : 'text-gray-700'}`}>{displayedPayment}</span>
                            </div>
                          )}
                          <div className="rounded-xl border border-gray-200 p-3 space-y-1 text-xs">
                            <p className="font-bold text-gray-700">현금영수증 · {order.cash_receipt ? RECEIPT_STATUS[order.cash_receipt.status] ?? order.cash_receipt.status : '미신청'}</p>
                            {order.cash_receipt?.requested && <>
                              <p>{order.cash_receipt.purpose === 'expense' ? '지출증빙용' : '소득공제용'} · {order.cash_receipt.identifier_masked}</p>
                              {order.cash_receipt.approval_number && <p>승인번호: {order.cash_receipt.approval_number}</p>}
                              {order.cash_receipt.amount != null && <p>발급금액: ₩{order.cash_receipt.amount.toLocaleString()}</p>}
                              {order.cash_receipt.issued_at && <p>발급일시: {new Date(order.cash_receipt.issued_at).toLocaleString('ko-KR')}</p>}
                              {order.cash_receipt.receipt_url && <a href={order.cash_receipt.receipt_url} target="_blank" rel="noopener noreferrer" className="inline-block font-bold text-blue-600">영수증 보기</a>}
                              {order.cash_receipt.status === 'failed' && <button disabled={updatingId === order.id} onClick={async () => {
                                setUpdatingId(order.id)
                                try { const res = await fetch('/api/admin/orders/receipt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: order.id }) }); const data = await res.json(); if (!res.ok) throw new Error(data.error); await fetchOrders() } catch (error) { setLoadError(error instanceof Error ? error.message : '발급 확인에 실패했습니다.') } finally { setUpdatingId(null) }
                              }} className="mt-1 rounded-lg border px-3 py-2 font-bold">발급 다시 시도</button>}
                              {['uncertain','manual_review','cancel_uncertain','issuing','cancel_pending'].includes(order.cash_receipt.status) && <p className="text-amber-700">페이앱 판매자 사이트에서 결과를 확인해주세요. 중복 발급을 방지하기 위해 자동 재발급하지 않습니다.</p>}
                            </>}
                          </div>
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

                  {!showTrash && <button type="button" onClick={() => setEditingOrder(order)} className="rounded-lg border border-orange-300 px-3 py-2 text-sm font-bold text-orange-600">주문정보 전체 수정</button>}
                  {/* Items */}
                  <div>
                    <p className="text-[11px] font-bold text-gray-400 mb-2">주문 상품</p>
                    <div className="space-y-1">
                      {order.items.map(item => (
                        <div key={item.id} className="flex justify-between text-sm">
                          <span className="text-gray-700 flex-1 truncate mr-2">{item.product_name} × {item.quantity}</span>
                          <span className="font-bold text-gray-900 flex-shrink-0">₩{(item.price * item.quantity).toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                    {order.shipping_breakdown && <ShippingBreakdown groups={order.shipping_breakdown} />}
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


