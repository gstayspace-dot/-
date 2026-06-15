'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, type DbOrder, type DbOrderItem } from '@/lib/supabaseClient'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

type OrderWithItems = DbOrder & { items: DbOrderItem[] }

const BANK_NAME    = '국민은행'
const BANK_ACCOUNT = '233001-04-329449'
const BANK_HOLDER  = '최영진(영진상사)'

const STATUS_STYLE: Record<string, string> = {
  '입금대기': 'bg-amber-100 text-amber-700',
  '결제완료': 'bg-green-100 text-green-700',
  '배송중':   'bg-blue-100  text-blue-700',
  '배송완료': 'bg-gray-100  text-gray-600',
}

function formatPhone(raw: string) {
  const digits = raw.replace(/\D/g, '').slice(0, 11)
  if (digits.length < 4) return digits
  if (digits.length < 8) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
}

export default function MyOrdersPage() {
  const router = useRouter()
  const [phone, setPhone] = useState('')
  const [orders, setOrders] = useState<OrderWithItems[]>([])
  const [searched, setSearched] = useState(false)
  const [searching, setSearching] = useState(false)

  const [editing, setEditing] = useState<string | null>(null)
  const [editAddress, setEditAddress] = useState('')
  const [editRequest, setEditRequest] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  async function lookupOrders() {
    const q = phone.trim()
    if (!q) return
    setSearching(true)
    setSearched(false)

    const [{ data: orderRows }, { data: itemRows }] = await Promise.all([
      db.from('orders').select('*').eq('customer_phone', q).order('created_at', { ascending: false }),
      db.from('order_items').select('*'),
    ]) as [{ data: DbOrder[] | null }, { data: DbOrderItem[] | null }]

    const allItems = itemRows ?? []
    const merged: OrderWithItems[] = (orderRows ?? []).map((o: DbOrder) => ({
      ...o,
      items: allItems.filter((i: DbOrderItem) => i.order_id === o.id),
    }))
    setOrders(merged)
    setSearched(true)
    setSearching(false)
  }

  function startEdit(order: OrderWithItems) {
    setEditing(order.id)
    setEditAddress(order.customer_address)
    setEditRequest(order.customer_request ?? '')
    setSaveMsg('')
  }

  async function saveEdit(orderId: string) {
    if (!editAddress.trim()) { setSaveMsg('주소를 입력해주세요.'); return }
    setSaving(true)
    const { error } = await db
      .from('orders')
      .update({ customer_address: editAddress.trim(), customer_request: editRequest.trim() })
      .eq('id', orderId)
    if (error) {
      setSaveMsg('저장 중 오류가 발생했습니다.')
    } else {
      setOrders(prev => prev.map(o =>
        o.id === orderId
          ? { ...o, customer_address: editAddress.trim(), customer_request: editRequest.trim() }
          : o
      ))
      setEditing(null)
      setSaveMsg('')
    }
    setSaving(false)
  }

  return (
    <div className="min-h-screen-safe bg-gray-50 flex justify-center">
      <div className="w-full max-w-[480px] bg-white min-h-screen-safe flex flex-col">

        {/* Header */}
        <header className="sticky top-0 z-20 bg-white border-b border-gray-100 px-4 py-3 pt-[calc(0.75rem_+_env(safe-area-inset-top))] flex items-center gap-3 flex-shrink-0">
          <button
            onClick={() => router.back()}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-gray-100 text-gray-700 font-bold text-lg flex-shrink-0"
          >
            ←
          </button>
          <h1 className="font-extrabold text-gray-900 text-sm flex-1">📦 내 주문 내역</h1>
        </header>

        <div className="flex-1 overflow-y-auto">

          {/* Phone lookup */}
          <div className="px-5 pt-6 pb-4">
            <p className="text-xs text-gray-500 mb-3">주문 시 입력한 전화번호로 주문 내역을 조회합니다.</p>
            <div className="flex gap-2">
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(formatPhone(e.target.value))}
                onKeyDown={e => { if (e.key === 'Enter') lookupOrders() }}
                placeholder="010-0000-0000"
                className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent transition"
              />
              <button
                onClick={lookupOrders}
                disabled={searching || !phone.trim()}
                className="text-white font-black px-5 py-3 rounded-xl text-sm active:scale-95 transition-all disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg,#ff6a00,#e53935)' }}
              >
                {searching ? '조회중…' : '조회'}
              </button>
            </div>
          </div>

          {/* Results */}
          {searched && (
            <div className="px-5 pb-8">
              {orders.length === 0 ? (
                <div className="text-center py-16">
                  <p className="text-4xl mb-3">📭</p>
                  <p className="text-gray-500 font-semibold">해당 번호로 접수된 주문이 없습니다.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-xs text-gray-400 font-medium">{orders.length}건의 주문을 찾았습니다.</p>
                  {orders.map(order => {
                    const canEdit = order.status === '입금대기'
                    const isEditing = editing === order.id
                    const itemsSubtotal = order.items.reduce((sum, it) => sum + it.price * it.quantity, 0)
                    const shippingFee = order.total_price - itemsSubtotal

                    return (
                      <div key={order.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">

                        {/* Order header */}
                        <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                          <div>
                            <span className="text-xs font-black text-gray-600">#{order.id.slice(0, 8).toUpperCase()}</span>
                            <span className="text-[11px] text-gray-400 ml-2">
                              {new Date(order.created_at).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', year: 'numeric' })}
                            </span>
                          </div>
                          <span className={`text-[11px] font-bold px-2.5 py-1 rounded-lg ${STATUS_STYLE[order.status] ?? 'bg-gray-100 text-gray-600'}`}>
                            {order.status}
                          </span>
                        </div>

                        <div className="px-4 py-4 space-y-3">

                          {/* Items */}
                          <div>
                            <p className="text-[11px] font-bold text-gray-400 mb-1.5">주문 상품</p>
                            <div className="space-y-1">
                              {order.items.map(item => (
                                <div key={item.id} className="flex justify-between text-sm">
                                  <span className="text-gray-700 flex-1 truncate mr-2">{item.product_name} × {item.quantity}</span>
                                  <span className="font-bold text-gray-900 flex-shrink-0">₩{(item.price * item.quantity).toLocaleString()}</span>
                                </div>
                              ))}
                              <div className="pt-1.5 border-t border-gray-100 flex justify-between">
                                <span className="text-xs text-gray-500">상품 합계</span>
                                <span className="text-sm font-bold text-gray-800">₩{itemsSubtotal.toLocaleString()}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-xs text-gray-500">배송비</span>
                                {shippingFee <= 0
                                  ? <span className="text-sm font-bold text-green-600">무료</span>
                                  : <span className="text-sm font-bold text-gray-700">₩{shippingFee.toLocaleString()}</span>}
                              </div>
                              <div className="pt-1.5 border-t border-gray-100 flex justify-between">
                                <span className="text-xs text-gray-500">총 결제금액</span>
                                <span className="text-sm font-black text-red-500">₩{order.total_price.toLocaleString()}</span>
                              </div>
                            </div>
                          </div>

                          {/* 입금 계좌 안내 */}
                          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5">
                              <p className="text-[11px] font-bold text-amber-600 mb-2 flex items-center gap-1">🏦 입금 계좌 안내</p>
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-[11px] text-amber-600 w-14 flex-shrink-0">은행</span>
                                  <span className="text-sm font-black text-gray-900">{BANK_NAME}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-[11px] text-amber-600 w-14 flex-shrink-0">계좌번호</span>
                                  <span className="text-sm font-black text-gray-900 tracking-wide">{BANK_ACCOUNT}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-[11px] text-amber-600 w-14 flex-shrink-0">예금주</span>
                                  <span className="text-sm font-bold text-gray-900">{BANK_HOLDER}</span>
                                </div>
                              </div>
                              <div className="pt-2 mt-2 border-t border-amber-200 flex justify-between items-center">
                                <span className="text-xs text-gray-600 font-medium">입금 금액</span>
                                <span className="text-sm font-black text-red-500">₩{order.total_price.toLocaleString()}</span>
                              </div>
                              <p className="text-[11px] text-amber-600 mt-2 leading-snug">
                                ※ 입금 확인 후 배송이 시작됩니다. 입금자명을 주문자명과 동일하게 입력해 주세요.
                              </p>
                            </div>

                          {/* Address / request — edit mode */}
                          {isEditing ? (
                            <div className="space-y-2.5 pt-2 border-t border-gray-100">
                              <p className="text-[11px] font-bold text-orange-500">✏️ 배송 정보 수정</p>
                              <div>
                                <label className="block text-[11px] font-bold text-gray-500 mb-1">배송 주소 *</label>
                                <textarea
                                  rows={2}
                                  value={editAddress}
                                  onChange={e => setEditAddress(e.target.value)}
                                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 transition resize-none"
                                />
                              </div>
                              <div>
                                <label className="block text-[11px] font-bold text-gray-500 mb-1">요청사항 (선택)</label>
                                <textarea
                                  rows={2}
                                  value={editRequest}
                                  onChange={e => setEditRequest(e.target.value)}
                                  placeholder="문 앞에 놓아주세요"
                                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 transition resize-none"
                                />
                              </div>
                              {saveMsg && <p className="text-xs text-red-500">{saveMsg}</p>}
                              <div className="flex gap-2">
                                <button
                                  onClick={() => { setEditing(null); setSaveMsg('') }}
                                  className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-gray-100 text-gray-600 active:scale-95 transition-all"
                                >
                                  취소
                                </button>
                                <button
                                  onClick={() => saveEdit(order.id)}
                                  disabled={saving}
                                  className="flex-1 py-2.5 rounded-xl text-sm font-black text-white active:scale-95 transition-all disabled:opacity-50"
                                  style={{ background: 'linear-gradient(135deg,#ff6a00,#e53935)' }}
                                >
                                  {saving ? '저장중…' : '저장'}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="pt-2 border-t border-gray-100 space-y-1">
                              <div className="flex items-start gap-2">
                                <span className="text-[11px] text-gray-400 w-12 flex-shrink-0 mt-0.5">주소</span>
                                <span className="text-sm text-gray-700 leading-snug flex-1">{order.customer_address}</span>
                              </div>
                              {order.customer_request && (
                                <div className="flex items-start gap-2">
                                  <span className="text-[11px] text-gray-400 w-12 flex-shrink-0 mt-0.5">요청</span>
                                  <span className="text-sm text-gray-500 italic">{order.customer_request}</span>
                                </div>
                              )}
                              {canEdit && (
                                <button
                                  onClick={() => startEdit(order)}
                                  className="mt-2 w-full text-orange-500 border border-orange-200 font-bold text-xs py-2 rounded-xl hover:bg-orange-50 active:scale-95 transition-all"
                                >
                                  ✏️ 배송 정보 수정
                                </button>
                              )}
                              {!canEdit && (
                                <p className="text-[11px] text-gray-400 mt-1">※ {order.status} 상태에서는 수정이 불가합니다.</p>
                              )}
                            </div>
                          )}

                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
