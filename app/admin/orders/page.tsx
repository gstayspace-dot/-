'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, type DbOrder, type DbOrderItem } from '@/lib/supabaseClient'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

type OrderWithItems = DbOrder & { items: DbOrderItem[] }

const STATUS_LIST = ['입금대기', '결제완료', '배송중', '배송완료'] as const

const STATUS_STYLE: Record<string, string> = {
  '입금대기': 'bg-amber-100 text-amber-700 border-amber-300',
  '결제완료': 'bg-green-100 text-green-700 border-green-300',
  '배송중':   'bg-blue-100  text-blue-700  border-blue-300',
  '배송완료': 'bg-gray-100  text-gray-600  border-gray-300',
}

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<OrderWithItems[]>([])
  const [loading, setLoading] = useState(true)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
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

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    const [{ data: orderRows }, { data: itemRows }] = await Promise.all([
      db.from('orders').select('*').order('created_at', { ascending: false }),
      db.from('order_items').select('*'),
    ]) as [{ data: DbOrder[] | null }, { data: DbOrderItem[] | null }]

    const allItems = itemRows ?? []
    const merged: OrderWithItems[] = (orderRows ?? []).map((o: DbOrder) => ({
      ...o,
      items: allItems.filter((i: DbOrderItem) => i.order_id === o.id),
    }))
    setOrders(merged)
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchOrders()

    const channel = supabase
      .channel('admin-orders-notify')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, async (payload) => {
        const newOrder = payload.new as DbOrder
        const { data: items } = await db.from('order_items').select('*').eq('order_id', newOrder.id)
        const full: OrderWithItems = { ...newOrder, items: (items ?? []) as DbOrderItem[] }
        setOrders(prev => [full, ...prev])
        playAlert()
        showToast(newOrder.customer_name, newOrder.total_price)
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchOrders])

  async function updateStatus(orderId: string, status: string) {
    setUpdatingId(orderId)
    await db.from('orders').update({ status }).eq('id', orderId)
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status } : o))
    setUpdatingId(null)
  }

  async function deleteOrder(orderId: string) {
    if (!confirm('이 주문을 삭제하시겠습니까?')) return
    await db.from('order_items').delete().eq('order_id', orderId)
    await db.from('orders').delete().eq('id', orderId)
    setOrders(prev => prev.filter(o => o.id !== orderId))
  }

  async function handleLogout() {
    await fetch('/api/admin/logout', { method: 'POST' })
    window.location.href = '/admin/login'
  }

  const totalRevenue = orders.reduce((s, o) => s + o.total_price, 0)
  const pending = orders.filter(o => o.status === '입금대기').length

  return (
    <div className="min-h-screen-safe bg-gray-50">

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

        {/* ── Stats ── */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: '전체 주문', value: `${orders.length}건`, color: 'text-gray-900' },
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
          <h2 className="text-sm font-extrabold text-gray-700">주문 목록 (최신순)</h2>
          <button
            onClick={fetchOrders}
            className="text-xs text-orange-500 hover:text-orange-600 font-bold border border-orange-200 rounded-lg px-3 py-1.5 transition-colors"
          >
            ↻ 새로고침
          </button>
        </div>

        {/* ── Order list ── */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-10 h-10 rounded-full border-4 border-orange-200 border-t-orange-500 animate-spin" />
          </div>
        ) : orders.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 py-20 text-center text-gray-400">
            <p className="text-4xl mb-3">📭</p>
            <p className="font-semibold">아직 접수된 주문이 없습니다.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {orders.map(order => (
              <div key={order.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">

                {/* Order header */}
                <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-black text-gray-500">#{order.id.slice(0, 8).toUpperCase()}</span>
                    <span className="text-xs text-gray-400">
                      {new Date(order.created_at).toLocaleString('ko-KR', {
                        month: 'short', day: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
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
                    {order.customer_request && (
                      <div className="flex items-start gap-2">
                        <span className="text-[11px] font-bold text-gray-400 w-14 flex-shrink-0 mt-0.5">요청</span>
                        <span className="text-sm text-gray-500 italic">{order.customer_request}</span>
                      </div>
                    )}
                  </div>

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
