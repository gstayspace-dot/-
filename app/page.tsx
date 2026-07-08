'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { Product } from '@/lib/types'
import { getCart, getCartCount } from '@/lib/cart-store'
import { supabase, type DbProduct, type DbChatMessage, rowToProduct, compareProducts } from '@/lib/supabaseClient'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any
import { getOrCreateSession, type ChatCustomer, type ChatMessage } from '@/lib/chat-store'

const DEFAULT = {
  name: '스테인리스 프리미엄 냄비 세트 5종',
  originalPrice: 89000,
  livePrice: 35600,
  quantity: 15,
  imageUrl: '',
}

const PRODUCT_EMOJIS = ['🍳', '🥘', '🫕', '🥄', '🔪', '🥗']

type LiveProduct = Product & { isLive: boolean }

export default function LivePage() {
  const router = useRouter()

  // ── Product & carousel state ──────────────────────────────────────────────
  const [allProducts, setAllProducts] = useState<LiveProduct[]>([])
  const [autoIdx, setAutoIdx] = useState(0)
  const activeProductsRef = useRef<LiveProduct[]>([])

  // ── Live counters ─────────────────────────────────────────────────────────
  const [quantity, setQuantity] = useState(DEFAULT.quantity)
  const [viewers, setViewers] = useState(2847)
  const [soldCount, setSoldCount] = useState(127)
  const [isUrgent, setIsUrgent] = useState(false)

  // ── Chat state ────────────────────────────────────────────────────────────
  const [mySession, setMySession] = useState<ChatCustomer | null>(null)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const chatRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<ChatCustomer | null>(null)
  const carouselRef = useRef<HTMLDivElement>(null)
  const carouselPausedRef = useRef(false)

  // ── Cart count ────────────────────────────────────────────────────────────
  const [cartCount, setCartCount] = useState(0)

  useEffect(() => {
    const update = () => setCartCount(getCartCount(getCart()))
    update()
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])

  // ── Deep-link: ?chat=1 → scroll to chat section ───────────────────────────
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('chat') === '1') {
      setTimeout(() => {
        document.getElementById('chat-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 400)
    }
  }, [])

  // ── Draggable cart button ──────────────────────────────────────────────────
  const [cartDragPos, setCartDragPos] = useState<{ x: number; y: number } | null>(null)
  const cartBtnRef = useRef<HTMLButtonElement>(null)
  const cartBtnDrag = useRef({ active: false, moved: false, startX: 0, startY: 0, startBtnX: 0, startBtnY: 0 })

  // ── Derived ───────────────────────────────────────────────────────────────
  const activeProducts = allProducts.filter(p => p.isLive)
  const activeProductColumns = Array.from(
    { length: Math.ceil(activeProducts.length / 2) },
    (_, idx) => activeProducts.slice(idx * 2, idx * 2 + 2),
  )
  const displayProduct = activeProducts.length > 0
    ? activeProducts[autoIdx % activeProducts.length]
    : null

  const pd = {
    name: displayProduct?.name ?? DEFAULT.name,
    originalPrice: displayProduct?.originalPrice ?? DEFAULT.originalPrice,
    livePrice: displayProduct?.livePrice ?? DEFAULT.livePrice,
    imageUrl: displayProduct?.imageUrl ?? DEFAULT.imageUrl,
  }
  const discountPct = Math.round((1 - pd.livePrice / pd.originalPrice) * 100)
  const savedAmt = pd.originalPrice - pd.livePrice
  const soldPercent = Math.min(99, Math.round((soldCount / (soldCount + quantity)) * 100))

  // ── Keep ref in sync for use inside interval ─────────────────────────────
  useEffect(() => { activeProductsRef.current = activeProducts }, [activeProducts])

  // ── Auto-cycle HERO image through live products (independent of carousel) ──
  useEffect(() => {
    if (activeProducts.length <= 1) return
    const t = setInterval(() => {
      setAutoIdx(prev => (prev + 1) % Math.max(1, activeProductsRef.current.length))
    }, 3000)
    return () => clearInterval(t)
  }, [activeProducts.length])

  // ── Auto-scroll CAROUSEL (independent of hero); stops once user touches ────
  useEffect(() => {
    const el = carouselRef.current
    if (!el || activeProducts.length <= 1) return

    const pause = () => { carouselPausedRef.current = true }
    el.addEventListener('touchstart', pause, { passive: true })
    el.addEventListener('mousedown', pause, { passive: true })
    el.addEventListener('wheel', pause, { passive: true })

    const t = setInterval(() => {
      if (carouselPausedRef.current) return
      const maxScroll = el.scrollWidth - el.clientWidth
      if (maxScroll <= 0) return
      const step = el.clientWidth * 0.6
      const next = el.scrollLeft + step >= maxScroll - 2 ? 0 : el.scrollLeft + step
      el.scrollTo({ left: next, behavior: 'smooth' })
    }, 2500)

    return () => {
      clearInterval(t)
      el.removeEventListener('touchstart', pause)
      el.removeEventListener('mousedown', pause)
      el.removeEventListener('wheel', pause)
    }
  }, [activeProducts.length])

  // ── Supabase: products realtime subscription ──────────────────────────────
  useEffect(() => {
    // Initial load
    supabase
      .from('products')
      .select('*')
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (!data) return
        const products = data.map(rowToProduct)
        setAllProducts(products)
        const firstLive = products.find(p => p.isLive)
        if (firstLive) {
          setQuantity(firstLive.quantity)
          setIsUrgent(firstLive.quantity <= 5)
        }
      })

    const channel = supabase
      .channel('products-live-page')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'products' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setAllProducts(prev => [rowToProduct(payload.new as DbProduct), ...prev].sort(compareProducts))
          } else if (payload.eventType === 'UPDATE') {
            const updated = rowToProduct(payload.new as DbProduct)
            setAllProducts(prev => prev.map(p => p.id === updated.id ? updated : p).sort(compareProducts))
          } else if (payload.eventType === 'DELETE') {
            const id = (payload.old as { id: string }).id
            setAllProducts(prev => prev.filter(p => p.id !== id))
          }
        },
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  // ── Supabase: chat init + realtime subscription ───────────────────────────
  useEffect(() => {
    const session = getOrCreateSession()
    setMySession(session)
    sessionRef.current = session

    // Register customer (upsert so page reloads don't create duplicates)
    db.from('chat_customers').upsert(
      { id: session.id, name: session.name, joined_at: session.joinedAt },
      { onConflict: 'id' },
    ).then()

    // Load existing messages
    supabase
      .from('chat_messages')
      .select('*')
      .eq('customer_id', session.id)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (!data) return
        setChatMessages(data.map(row => ({
          id: row.id,
          customerId: row.customer_id,
          text: row.text,
          isAdmin: row.is_admin,
          ts: row.created_at,
        })))
      })

    // Subscribe to new messages for this customer
    const channel = supabase
      .channel(`chat-customer-${session.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `customer_id=eq.${session.id}`,
        },
        (payload) => {
          const row = payload.new as DbChatMessage
          const msg: ChatMessage = {
            id: row.id,
            customerId: row.customer_id,
            text: row.text,
            isAdmin: row.is_admin,
            ts: row.created_at,
          }
          // Deduplicate (customer's own optimistic messages already in state)
          setChatMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg])
        },
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  // ── Auto-scroll chat ──────────────────────────────────────────────────────
  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [chatMessages.length])

  // ── UI-only: fake urgency animation ──────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => {
      setQuantity(prev => { const n = prev > 3 ? prev - 1 : prev; if (n <= 5) setIsUrgent(true); return n })
      setSoldCount(prev => prev + Math.floor(Math.random() * 3 + 1))
    }, 9000)
    return () => clearInterval(t)
  }, [])

  // ── UI-only: viewer count flicker ─────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setViewers(prev => Math.max(2000, prev + Math.floor(Math.random() * 30) - 10)), 3500)
    return () => clearInterval(t)
  }, [])

  // ── Non-passive touchmove for draggable cart button ───────────────────────
  useEffect(() => {
    const el = cartBtnRef.current
    if (!el) return
    const onMove = (e: TouchEvent) => {
      if (!cartBtnDrag.current.active) return
      const t = e.touches[0]
      const dx = t.clientX - cartBtnDrag.current.startX
      const dy = t.clientY - cartBtnDrag.current.startY
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return
      e.preventDefault()
      cartBtnDrag.current.moved = true
      setCartDragPos({
        x: Math.max(8, Math.min(window.innerWidth  - 64, cartBtnDrag.current.startBtnX + dx)),
        y: Math.max(8, Math.min(window.innerHeight - 64, cartBtnDrag.current.startBtnY + dy)),
      })
    }
    el.addEventListener('touchmove', onMove, { passive: false })
    return () => el.removeEventListener('touchmove', onMove)
  }, [])

  // ── Send chat message ─────────────────────────────────────────────────────
  async function sendMessage() {
    const text = chatInput.trim()
    if (!text || !mySession) return
    const msg: ChatMessage = {
      id: `m_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      customerId: mySession.id,
      text,
      isAdmin: false,
      ts: new Date().toISOString(),
    }
    // Optimistic update
    setChatMessages(prev => [...prev, msg])
    setChatInput('')
    await db.from('chat_messages').insert({
      id: msg.id,
      customer_id: msg.customerId,
      text: msg.text,
      is_admin: false,
      created_at: msg.ts,
    })
    fetch('/api/chat/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerName: mySession.name, message: text }),
    }).catch(() => {})
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen-safe bg-gray-100 flex justify-center items-start">
      <div className="w-full max-w-[480px] bg-white flex flex-col min-h-screen-safe shadow-2xl">

        {/* ── LIVE HEADER ── */}
        <header className="sticky top-0 z-30 bg-black text-white px-4 py-2.5 pt-[calc(0.625rem_+_env(safe-area-inset-top))] flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => router.push('/cart')}
              className="relative w-8 h-8 flex items-center justify-center mr-0.5"
              aria-label="장바구니"
            >
              <span className="text-lg">🛒</span>
              {cartCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center leading-none">
                  {cartCount > 9 ? '9+' : cartCount}
                </span>
              )}
            </button>
            <span className="live-pulse bg-red-500 text-[11px] font-black px-2 py-0.5 rounded tracking-wider">
              ● LIVE
            </span>
            <span className="text-sm font-medium text-gray-200">라이브쇼핑</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-gray-300">
            <span>👁 {viewers.toLocaleString()}</span>
            <span className="text-gray-600">|</span>
            <span className="text-orange-400 font-bold">판매 {soldCount}</span>
          </div>
        </header>

        {/* ══ HERO IMAGE — 50vh (탭 시 전체 상품 보기) ══ */}
        <div
          onClick={() => router.push(displayProduct ? `/shop?focus=${displayProduct.id}` : '/shop')}
          className="relative flex-shrink-0 cursor-pointer"
          style={{ height: '50vh' }}
        >
          <div className="absolute inset-0">
            {pd.imageUrl ? (
              <img src={pd.imageUrl} alt={pd.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-orange-50 via-amber-50 to-yellow-50 flex flex-col items-center justify-center gap-3">
                <div className="text-[90px] leading-none">🍳</div>
                <div className="flex gap-4 text-4xl">🥘 🫕 🥄</div>
              </div>
            )}
          </div>

          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />

          <div className="absolute top-4 left-4">
            <span className="bg-red-500 text-white font-black text-lg px-3 py-1.5 rounded-xl shadow-lg shadow-red-900/30 block">
              {discountPct}% OFF
            </span>
          </div>
          <div className="absolute top-4 right-4">
            <span className="bg-gradient-to-r from-orange-500 to-red-500 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg shadow-md block">
              📺 라방 특가
            </span>
          </div>

          {displayProduct && activeProducts.some(p => p.id === displayProduct.id) && (
            <div className="absolute top-14 left-4">
              <span className="live-pulse bg-black/60 text-white text-[10px] font-bold px-2 py-1 rounded-lg backdrop-blur-sm">
                ● 현재 LIVE
              </span>
            </div>
          )}

          {/* 전체 상품 보기 유도 */}
          <div className="absolute bottom-4 right-4">
            <span className="bg-white/90 text-gray-900 text-[11px] font-black px-3 py-1.5 rounded-full shadow-lg backdrop-blur-sm flex items-center gap-1 animate-pulse">
              👆 전체 상품 보기
            </span>
          </div>

          <div className="absolute bottom-0 left-0 right-0 px-4 pb-5 pt-16 pointer-events-none">
            <p className="text-white/70 text-xs mb-1.5 flex items-center gap-1">
              🚚 오늘 주문 시 내일 도착 &nbsp;•&nbsp; 5만원↑ 무료배송
            </p>
            <h1 className="text-white font-extrabold text-xl leading-tight mb-2.5 drop-shadow-lg">
              {pd.name}
            </h1>
            <div className="flex items-end gap-2.5">
              <span className="text-white text-[28px] font-black leading-none">
                ₩{pd.livePrice.toLocaleString()}
              </span>
              <span className="text-white/55 line-through text-base mb-0.5">
                ₩{pd.originalPrice.toLocaleString()}
              </span>
              <span className="text-orange-300 text-sm font-bold mb-0.5">
                ₩{savedAmt.toLocaleString()} 절약
              </span>
            </div>
          </div>
        </div>

        {/* ══ URGENCY + PROGRESS ══ */}
        <section className="px-4 pt-4 pb-3 bg-white flex-shrink-0">
          <div className="flex gap-2.5 mb-3">
            <div className={`flex-1 rounded-2xl p-3 text-center transition-all duration-500 ${isUrgent ? 'bg-red-500 shadow-md shadow-red-200' : 'bg-gradient-to-br from-orange-500 to-red-500'}`}>
              <div className="text-white text-[10px] font-semibold mb-0.5 opacity-90">⚠️ 남은 수량</div>
              <div className={`text-white text-3xl font-black leading-tight ${isUrgent ? 'animate-quantity-blink' : ''}`}>
                {quantity}<span className="text-lg font-bold">개</span>
              </div>
              {isUrgent && <div className="text-red-100 text-[10px] mt-0.5 font-bold">품절 임박!!</div>}
            </div>
            <div className="flex-1 bg-gray-900 rounded-2xl p-3 text-center">
              <div className="text-gray-400 text-[10px] font-semibold mb-0.5">🔒 오늘만</div>
              <div className="text-white text-2xl font-black">TODAY</div>
              <div className="text-orange-400 text-[10px] font-bold">ONLY</div>
            </div>
            <div className="flex-1 bg-green-50 border-2 border-green-200 rounded-2xl p-3 text-center">
              <div className="text-green-600 text-[10px] font-semibold mb-0.5">🚚 배송</div>
              <div className="text-green-600 text-sm font-black leading-tight">5만↑<br />무료배송</div>
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-gray-500 font-medium">판매 현황</span>
              <span className="text-red-500 font-extrabold">{soldPercent}% 소진 🔥</span>
            </div>
            <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full progress-glow transition-all duration-1000"
                style={{ width: `${soldPercent}%`, background: 'linear-gradient(90deg,#fb923c,#ef4444)' }}
              />
            </div>
            <div className="text-[10px] text-gray-400 mt-1 text-right">{soldCount}명 구매 완료</div>
          </div>
        </section>

        {/* ══ PRODUCT CAROUSEL (라이브 송출 상품만) ══ */}
        {activeProducts.length > 0 && (
          <section className="bg-white border-t border-gray-100 px-4 pt-3 pb-4 flex-shrink-0">
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-sm font-extrabold text-gray-800">📦 라이브 상품</span>
              <button
                onClick={() => router.push('/shop')}
                className="text-[11px] text-orange-500 font-bold active:scale-95 transition-transform"
              >
                전체 상품 보기 →
              </button>
            </div>

            <div
              ref={carouselRef}
              className="flex gap-3 overflow-x-auto no-scrollbar"
              style={{ scrollSnapType: 'x mandatory' }}
            >
              {activeProductColumns.map((column, columnIdx) => (
                <div
                  key={column.map(product => product.id).join('-')}
                  className="flex flex-col gap-3 flex-shrink-0 w-[134px]"
                  style={{ scrollSnapAlign: 'start' }}
                >
                  {column.map((product, rowIdx) => {
                    const productIdx = columnIdx * 2 + rowIdx
                    const disc = Math.round((1 - product.livePrice / product.originalPrice) * 100)
                    const fallbackEmoji = PRODUCT_EMOJIS[productIdx % PRODUCT_EMOJIS.length]

                    return (
                      <button
                        key={product.id}
                        onClick={() => router.push(`/shop?focus=${product.id}`)}
                        className="w-[134px] rounded-2xl overflow-hidden border-2 border-gray-200 hover:border-orange-200 transition-all active:scale-95"
                      >
                        <div className="h-[88px] relative flex items-center justify-center overflow-hidden bg-gray-50">
                          {product.imageUrl ? (
                            <img src={product.imageUrl} alt={product.name} loading="lazy" className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-4xl">{fallbackEmoji}</span>
                          )}
                          <span className="live-pulse absolute top-1.5 left-1.5 text-[9px] bg-red-500 text-white px-1.5 py-0.5 rounded font-black">
                            ● LIVE
                          </span>
                        </div>

                        <div className="px-2 py-2 text-left bg-white">
                          <p className="text-[11px] font-bold text-gray-800 leading-tight line-clamp-2 min-h-[28px]">
                            {product.name}
                          </p>
                          <div className="flex items-center justify-between mt-1.5">
                            <span className="text-[12px] font-black text-red-500">
                              ₩{product.livePrice.toLocaleString()}
                            </span>
                            <span className="text-[10px] font-bold text-orange-500 bg-orange-100 px-1.5 py-0.5 rounded-md">
                              -{disc}%
                            </span>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ══ REAL-TIME CHAT ══ */}
        <section id="chat-section" className="flex flex-col flex-1 mt-2 border-t-8 border-gray-100">
          <div className="px-4 py-3 bg-white border-b border-gray-100 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-extrabold text-gray-800">💬 관리자 1:1 상담</span>
              <span className="live-pulse text-[10px] bg-green-500 text-white px-2 py-0.5 rounded-full font-bold">
                온라인
              </span>
            </div>
            {mySession && (
              <span className="text-[11px] text-gray-400">{mySession.name}으로 참여 중</span>
            )}
          </div>

          <div
            ref={chatRef}
            className="no-scrollbar overflow-y-auto px-4 py-4 bg-gray-50 space-y-2"
            style={{ minHeight: '220px', maxHeight: '300px' }}
          >
            <div className="flex justify-center mb-3">
              <span className="text-[11px] text-gray-400 bg-gray-200 px-3 py-1 rounded-full">
                궁금한 점을 편하게 물어보세요 😊
              </span>
            </div>

            {chatMessages.length === 0 && (
              <div className="text-center py-6">
                <div className="text-4xl mb-2">💬</div>
                <p className="text-sm text-gray-400">첫 메시지를 보내보세요!</p>
                <p className="text-xs text-gray-300 mt-1">평균 응답 시간 1분 이내</p>
              </div>
            )}

            {chatMessages.map(msg => (
              <div key={msg.id} className={`flex animate-fade-in ${msg.isAdmin ? 'justify-start' : 'justify-end'}`}>
                {msg.isAdmin && (
                  <div className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center text-white text-[11px] font-extrabold mr-2 mt-1 flex-shrink-0">관</div>
                )}
                <div className={`flex flex-col max-w-[72%] ${msg.isAdmin ? 'items-start' : 'items-end'}`}>
                  {msg.isAdmin && <p className="text-[11px] text-gray-400 mb-0.5 ml-1">관리자</p>}
                  <div
                    className={`px-3.5 py-2 text-sm leading-relaxed rounded-2xl break-words shadow-sm ${
                      msg.isAdmin ? 'bg-white text-gray-800 rounded-tl-sm border border-gray-100' : 'text-white rounded-tr-sm'
                    }`}
                    style={!msg.isAdmin ? { background: 'linear-gradient(135deg,#ff6a00,#e53935)' } : {}}
                  >
                    {msg.text}
                  </div>
                  <p className="text-[10px] text-gray-400 mt-0.5 mx-1">
                    {new Date(msg.ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="px-4 py-3 bg-white border-t border-gray-100 flex-shrink-0">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
                placeholder="관리자에게 문의하세요..."
                className="flex-1 bg-gray-100 rounded-2xl px-4 py-2.5 text-sm text-gray-800 placeholder-gray-400 outline-none focus:ring-2 focus:ring-orange-300 transition-all"
              />
              <button
                onClick={sendMessage}
                disabled={!chatInput.trim()}
                className="w-11 h-11 rounded-2xl flex items-center justify-center text-white text-lg font-black shadow-sm active:scale-90 transition-all disabled:opacity-40 flex-shrink-0"
                style={{ background: chatInput.trim() ? 'linear-gradient(135deg,#ff6a00,#e53935)' : '#d1d5db' }}
              >
                ↑
              </button>
            </div>
            <p className="text-[10px] text-gray-400 mt-1.5 text-center">
              관리자가 곧 답변드릴게요 &nbsp;•&nbsp; 평균 응답 1분
            </p>
          </div>
        </section>

        <div className="px-5 py-4 pb-[calc(1rem_+_env(safe-area-inset-bottom))] bg-white border-t border-gray-100 flex-shrink-0 space-y-2.5">
          <a
            href="/my-orders"
            className="flex items-center justify-center gap-2 w-full py-4 rounded-2xl font-black text-base text-white shadow-lg active:scale-95 transition-all"
            style={{ background: 'linear-gradient(135deg,#ff6a00,#e53935)' }}
          >
            <span className="text-xl">📦</span>
            내 주문 내역 확인하기
          </a>
          <div className="border-t border-gray-100 pt-3 text-center space-y-0.5">
            <p className="text-[11px] text-gray-400 font-bold">영진상사</p>
            <p className="text-[11px] text-gray-400">대표 최영진 &nbsp;|&nbsp; 사업자등록번호 501-06-97617</p>
            <p className="text-[11px] text-gray-400">고객센터 / 개인정보 관리책임자 : 최영진 (032-327-1116)</p>
            <p className="text-[10px] text-gray-300 pt-1">© 영진상사. All rights reserved.</p>
            <a href="/admin/products" className="inline-block text-[11px] text-gray-300 hover:text-gray-500 transition-colors pt-1">관리자</a>
          </div>
        </div>

      </div>

      {/* ── Draggable Floating Cart Button ── */}
      <button
        ref={cartBtnRef}
        style={cartDragPos ? { left: cartDragPos.x, top: cartDragPos.y } : { left: 16, top: '50vh', transform: 'translateY(-50%)' }}
        className="fixed z-50 w-14 h-14 rounded-full bg-white border-2 border-orange-300 flex flex-col items-center justify-center shadow-xl select-none cursor-grab active:cursor-grabbing transition-colors duration-200"
        aria-label="장바구니"
        onTouchStart={(e) => {
          const t = e.touches[0]
          const rect = e.currentTarget.getBoundingClientRect()
          cartBtnDrag.current = { active: true, moved: false, startX: t.clientX, startY: t.clientY, startBtnX: rect.left, startBtnY: rect.top }
        }}
        onTouchEnd={() => { cartBtnDrag.current.active = false }}
        onClick={() => {
          if (cartBtnDrag.current.moved) { cartBtnDrag.current.moved = false; return }
          router.push('/cart')
        }}
      >
        <span className="text-[22px] leading-none">🛒</span>
        {cartCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-black flex items-center justify-center">
            {cartCount > 9 ? '9+' : cartCount}
          </span>
        )}
      </button>

    </div>
  )
}
