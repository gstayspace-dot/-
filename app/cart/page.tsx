'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import {
  getCart, setItemQuantity, removeFromCart, clearCart,
  getCartTotal, type CartItem,
} from '@/lib/cart-store'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

type Step = 'cart' | 'form' | 'done'

const BANK_NAME   = '국민은행'
const BANK_ACCOUNT = '233001-04-329449'
const BANK_HOLDER  = '최영진(영진상사)'

export default function CartPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('cart')
  const [cart, setCart] = useState<CartItem[]>([])
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [request, setRequest] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [orderId, setOrderId] = useState('')
  const [doneCart, setDoneCart] = useState<CartItem[]>([])
  const [doneTotal, setDoneTotal] = useState(0)
  const [payMethod, setPayMethod] = useState<'bank' | 'card'>('bank')
  const [cardNum, setCardNum] = useState('')
  const [cardExpiry, setCardExpiry] = useState('')
  const [cardPw, setCardPw] = useState('')
  const [cardCvc, setCardCvc] = useState('')

  useEffect(() => {
    setCart(getCart())
    if (new URLSearchParams(window.location.search).get('checkout') === '1') {
      setStep('form')
    }
  }, [])

  function refresh() { setCart(getCart()) }

  function updateQty(productId: string, qty: number) {
    setItemQuantity(productId, qty); refresh()
  }

  function remove(productId: string) {
    removeFromCart(productId); refresh()
  }

  const subtotal = getCartTotal(cart)
  const FREE_SHIPPING_MIN = 50000
  const SHIPPING_FEE = 4000
  const shippingFee = subtotal >= FREE_SHIPPING_MIN ? 0 : SHIPPING_FEE
  const total = subtotal + shippingFee

  function formatCardNum(raw: string) {
    const d = raw.replace(/\D/g, '').slice(0, 16)
    return d.replace(/(.{4})(?=.)/g, '$1-')
  }

  function formatExpiry(raw: string) {
    const d = raw.replace(/\D/g, '').slice(0, 4)
    return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d
  }

  function formatPhone(raw: string) {
    const digits = raw.replace(/\D/g, '').slice(0, 11)
    if (digits.length < 4) return digits
    if (digits.length < 8) return `${digits.slice(0, 3)}-${digits.slice(3)}`
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
  }

  async function handleSubmit() {
    if (!name.trim() || !phone.trim() || !address.trim()) {
      setSubmitError('이름, 전화번호, 주소는 필수 입력 항목입니다.')
      return
    }
    if (payMethod === 'card') {
      const digits = cardNum.replace(/\D/g, '')
      if (digits.length < 16) { setSubmitError('카드번호 16자리를 입력해주세요.'); return }
      if (cardExpiry.length < 5) { setSubmitError('유효기간을 MM/YY 형식으로 입력해주세요.'); return }
      if (cardPw.length < 2) { setSubmitError('비밀번호 앞 2자리를 입력해주세요.'); return }
      if (cardCvc.length < 3) { setSubmitError('CVC 3자리를 입력해주세요.'); return }
    }
    setSubmitError('')
    setSubmitting(true)
    const payNote = payMethod === 'card'
      ? `[카드결제 ****${cardNum.replace(/\D/g, '').slice(-4)} 유효기간:${cardExpiry}]`
      : '[계좌이체]'
    const fullRequest = [payNote, request.trim()].filter(Boolean).join(' | ')
    try {
      const { data: order, error: oErr } = await db
        .from('orders')
        .insert({
          customer_name: name.trim(),
          customer_phone: phone.trim(),
          customer_address: address.trim(),
          customer_request: fullRequest,
          total_price: total,
          status: '입금대기',
        })
        .select('id')
        .single()

      if (oErr || !order) throw new Error(oErr?.message ?? '주문 생성 실패')

      const items = cart.map((i: CartItem) => ({
        order_id: order.id as string,
        product_id: i.productId,
        product_name: i.productName,
        quantity: i.quantity,
        price: i.price,
      }))
      const { error: iErr } = await db.from('order_items').insert(items)
      if (iErr) throw new Error(iErr.message)

      setDoneCart([...cart])
      setDoneTotal(total)
      setOrderId((order.id as string).slice(0, 8).toUpperCase())
      clearCart()
      setCart([])
      setStep('done')
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : '주문 중 오류가 발생했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── STEP: DONE ────────────────────────────────────────────────────────────
  if (step === 'done') {
    const doneSubtotal = getCartTotal(doneCart)
    const doneShipping = doneTotal - doneSubtotal
    return (
      <div className="min-h-screen-safe bg-gray-50 flex justify-center">
        <div className="w-full max-w-[480px] bg-white min-h-screen-safe flex flex-col">
          <div className="flex-1 px-5 py-10 flex flex-col items-center text-center">
            <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mb-5">
              <span className="text-4xl">✅</span>
            </div>
            <h1 className="text-xl font-black text-gray-900 mb-1">주문이 완료되었습니다!</h1>
            <p className="text-sm text-gray-500 mb-6">주문번호: <span className="font-bold text-gray-700">#{orderId}</span></p>

            {/* 계좌 이체 안내 */}
            <div className="w-full bg-amber-50 border-2 border-amber-300 rounded-2xl p-5 mb-5 text-left">
              <p className="text-xs font-bold text-amber-600 mb-3 flex items-center gap-1">🏦 입금 계좌 안내</p>
              <div className="space-y-1 mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-amber-600 w-14 flex-shrink-0">은행</span>
                  <span className="text-sm font-black text-gray-900">{BANK_NAME}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-amber-600 w-14 flex-shrink-0">계좌번호</span>
                  <span className="text-base font-black text-gray-900 tracking-widest">{BANK_ACCOUNT}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-amber-600 w-14 flex-shrink-0">예금주</span>
                  <span className="text-sm font-bold text-gray-900">{BANK_HOLDER}</span>
                </div>
              </div>
              <div className="pt-3 border-t border-amber-200 flex justify-between items-center">
                <span className="text-sm text-gray-600 font-medium">입금 금액</span>
                <span className="text-lg font-black text-red-500">₩{doneTotal.toLocaleString()}</span>
              </div>
              <p className="text-[11px] text-amber-600 mt-2">
                ※ 입금 확인 후 배송이 시작됩니다. 입금자명을 주문자명과 동일하게 입력해 주세요.
              </p>
            </div>

            {/* 주문 상품 요약 */}
            <div className="w-full bg-gray-50 rounded-2xl p-4 text-left mb-6">
              <p className="text-xs font-bold text-gray-500 mb-3">주문 상품</p>
              <div className="space-y-2">
                {doneCart.map(i => (
                  <div key={i.productId} className="flex justify-between text-sm">
                    <span className="text-gray-700 flex-1 truncate mr-2">{i.productName} × {i.quantity}</span>
                    <span className="font-bold text-gray-900 flex-shrink-0">₩{(i.price * i.quantity).toLocaleString()}</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-gray-200 mt-3 pt-3 space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">상품 합계</span>
                  <span className="font-bold text-gray-800">₩{doneSubtotal.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">배송비</span>
                  {doneShipping === 0
                    ? <span className="font-bold text-green-600">무료</span>
                    : <span className="font-bold text-gray-700">₩{doneShipping.toLocaleString()}</span>}
                </div>
                <div className="flex justify-between pt-1.5 border-t border-gray-200">
                  <span className="font-bold text-gray-700">총 결제금액</span>
                  <span className="font-black text-red-500">₩{doneTotal.toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex-shrink-0 px-5 py-4 pb-[calc(1rem_+_env(safe-area-inset-bottom))] bg-white border-t border-gray-100 space-y-2">
            <button
              onClick={() => router.push('/my-orders')}
              className="w-full font-black py-3 rounded-2xl text-sm border-2 border-orange-300 text-orange-500 hover:bg-orange-50 active:scale-95 transition-all"
            >
              📦 내 주문 내역 확인
            </button>
            <button
              onClick={() => router.push('/')}
              className="w-full text-white font-black py-4 rounded-2xl text-sm shadow-lg active:scale-95 transition-all"
              style={{ background: 'linear-gradient(135deg,#ff6a00,#e53935)' }}
            >
              📺 라이브 계속 보기
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── STEP: ORDER FORM ──────────────────────────────────────────────────────
  if (step === 'form') {
    return (
      <div className="min-h-screen-safe bg-gray-50 flex justify-center">
        <div className="w-full max-w-[480px] bg-white min-h-screen-safe flex flex-col">

          <header className="sticky top-0 z-20 bg-white border-b border-gray-100 px-4 py-3 pt-[calc(0.75rem_+_env(safe-area-inset-top))] flex items-center gap-3 flex-shrink-0">
            <button
              onClick={() => setStep('cart')}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-gray-100 text-gray-700 font-bold text-lg flex-shrink-0"
            >
              ←
            </button>
            <h1 className="font-extrabold text-gray-900 text-sm flex-1">주문서 작성</h1>
          </header>

          {/* Progress */}
          <div className="flex items-center justify-center gap-2 py-3 border-b border-gray-100 bg-white flex-shrink-0">
            {['장바구니', '주문서', '완료'].map((label, i) => (
              <div key={label} className="flex items-center gap-2">
                <div className={`flex items-center gap-1.5 text-xs font-bold ${i === 1 ? 'text-orange-500' : 'text-gray-300'}`}>
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${i === 1 ? 'bg-orange-500 text-white' : i === 0 ? 'bg-gray-200 text-gray-500' : 'bg-gray-100 text-gray-300'}`}>{i + 1}</span>
                  {label}
                </div>
                {i < 2 && <span className="text-gray-200">›</span>}
              </div>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto">

            {/* Order summary */}
            <div className="px-5 py-4 bg-gray-50 border-b border-gray-100">
              <p className="text-xs font-bold text-gray-500 mb-2">주문 상품 ({cart.length}종)</p>
              <div className="space-y-1">
                {cart.map(i => (
                  <div key={i.productId} className="flex justify-between text-sm">
                    <span className="text-gray-600 flex-1 truncate mr-2">{i.productName} × {i.quantity}</span>
                    <span className="font-bold flex-shrink-0">₩{(i.price * i.quantity).toLocaleString()}</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-gray-200 mt-2 pt-2 space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">상품 합계</span>
                  <span className="font-bold">₩{subtotal.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">배송비</span>
                  {shippingFee === 0
                    ? <span className="font-bold text-green-600">무료</span>
                    : <span className="font-bold text-gray-700">₩{shippingFee.toLocaleString()}</span>}
                </div>
                <div className="flex justify-between pt-1 border-t border-gray-200">
                  <span className="text-sm font-bold text-gray-700">총 결제금액</span>
                  <span className="font-black text-red-500">₩{total.toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* Payment method */}
            <div className="px-5 py-4 bg-white border-b border-gray-100">
              <p className="text-xs font-bold text-gray-600 mb-3">결제 수단</p>
              <div className="flex gap-2">
                {(['bank', 'card'] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setPayMethod(m)}
                    className={`flex-1 py-3 rounded-xl text-sm font-bold border-2 transition-all ${
                      payMethod === m
                        ? 'border-orange-400 bg-orange-50 text-orange-600'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}
                  >
                    {m === 'bank' ? '🏦 계좌이체' : '💳 카드결제'}
                  </button>
                ))}
              </div>

              {payMethod === 'card' && (
                <div className="mt-4 space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1.5">카드번호 <span className="text-red-400">*</span></label>
                    <input
                      type="tel"
                      value={cardNum}
                      onChange={e => setCardNum(formatCardNum(e.target.value))}
                      onFocus={e => setTimeout(() => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300)}
                      placeholder="0000-0000-0000-0000"
                      className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm tracking-widest focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
                    />
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="block text-xs font-bold text-gray-600 mb-1.5">유효기간 <span className="text-red-400">*</span></label>
                      <input
                        type="tel"
                        value={cardExpiry}
                        onChange={e => setCardExpiry(formatExpiry(e.target.value))}
                        onFocus={e => setTimeout(() => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300)}
                        placeholder="MM/YY"
                        className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm tracking-widest focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs font-bold text-gray-600 mb-1.5">CVC <span className="text-red-400">*</span></label>
                      <input
                        type="tel"
                        value={cardCvc}
                        onChange={e => setCardCvc(e.target.value.replace(/\D/g, '').slice(0, 4))}
                        onFocus={e => setTimeout(() => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300)}
                        placeholder="000"
                        className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm tracking-widest focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1.5">비밀번호 앞 2자리 <span className="text-red-400">*</span></label>
                    <input
                      type="password"
                      value={cardPw}
                      onChange={e => setCardPw(e.target.value.replace(/\D/g, '').slice(0, 2))}
                      onFocus={e => setTimeout(() => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300)}
                      placeholder="••"
                      className="w-40 border border-gray-200 rounded-xl px-4 py-3 text-sm tracking-widest focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
                    />
                    <p className="text-[11px] text-gray-400 mt-1">카드 비밀번호 앞 2자리만 입력합니다.</p>
                  </div>
                </div>
              )}
            </div>

            {/* Form fields */}
            <div className="px-5 py-5 space-y-4 bg-white">
              {submitError && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600 font-medium">
                  {submitError}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1.5">
                  이름 <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  onFocus={e => setTimeout(() => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300)}
                  placeholder="홍길동"
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent transition"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1.5">
                  전화번호 <span className="text-red-400">*</span>
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(formatPhone(e.target.value))}
                  onFocus={e => setTimeout(() => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300)}
                  placeholder="010-0000-0000"
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent transition"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1.5">
                  배송 주소 <span className="text-red-400">*</span>
                </label>
                <textarea
                  rows={2}
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                  onFocus={e => setTimeout(() => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300)}
                  placeholder="서울시 강남구 테헤란로 123, 456호"
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent transition resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1.5">
                  요청사항 <span className="text-gray-400 font-normal">(선택)</span>
                </label>
                <textarea
                  rows={2}
                  value={request}
                  onChange={e => setRequest(e.target.value)}
                  onFocus={e => setTimeout(() => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300)}
                  placeholder="문 앞에 놓아주세요"
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent transition resize-none"
                />
              </div>
            </div>

            <div className="h-24" />
          </div>

          <div className="flex-shrink-0 bg-white border-t border-gray-100 px-5 py-4 pb-[calc(1rem_+_env(safe-area-inset-bottom))]">
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full text-white font-black py-4 rounded-2xl text-sm shadow-lg active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: 'linear-gradient(135deg,#ff6a00,#e53935)' }}
            >
              {submitting ? '주문 처리 중...' : `주문하기 · ₩${total.toLocaleString()}`}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── STEP: CART ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen-safe bg-gray-50 flex justify-center">
      <div className="w-full max-w-[480px] bg-white min-h-screen-safe flex flex-col">

        <header className="sticky top-0 z-20 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 flex-shrink-0">
          <button
            onClick={() => router.back()}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-gray-100 text-gray-700 font-bold text-lg flex-shrink-0"
          >
            ←
          </button>
          <h1 className="font-extrabold text-gray-900 text-sm flex-1">🛒 장바구니</h1>
          {cart.length > 0 && (
            <span className="text-xs text-gray-400">{cart.length}종 · ₩{total.toLocaleString()}</span>
          )}
        </header>

        <div className="flex-1 overflow-y-auto">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 gap-4">
              <span className="text-6xl">🛒</span>
              <p className="text-gray-500 font-semibold">장바구니가 비어있습니다.</p>
              <button
                onClick={() => router.push('/')}
                className="text-orange-500 font-bold underline underline-offset-2 text-sm"
              >
                라이브 보러 가기
              </button>
            </div>
          ) : (
            <div className="px-4 py-4 space-y-3">
              {cart.map(item => (
                <div key={item.productId} className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm flex items-stretch">
                  <div className="w-20 flex-shrink-0 bg-gray-50 flex items-center justify-center overflow-hidden">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt={item.productName} className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <span className="text-3xl">🛍</span>
                    )}
                  </div>
                  <div className="flex-1 px-3 py-3 min-w-0">
                    <p className="text-sm font-bold text-gray-900 leading-tight line-clamp-2">{item.productName}</p>
                    <p className="text-red-500 font-black text-sm mt-1">₩{item.price.toLocaleString()}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        onClick={() => updateQty(item.productId, item.quantity - 1)}
                        className="w-7 h-7 rounded-full border border-gray-200 flex items-center justify-center text-gray-600 font-bold hover:bg-gray-100 transition-colors"
                      >
                        −
                      </button>
                      <span className="text-sm font-bold text-gray-900 w-5 text-center">{item.quantity}</span>
                      <button
                        onClick={() => updateQty(item.productId, item.quantity + 1)}
                        className="w-7 h-7 rounded-full border border-gray-200 flex items-center justify-center text-gray-600 font-bold hover:bg-gray-100 transition-colors"
                      >
                        +
                      </button>
                      <span className="text-xs text-gray-400 ml-1">= ₩{(item.price * item.quantity).toLocaleString()}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => remove(item.productId)}
                    className="flex-shrink-0 w-10 flex items-center justify-center text-gray-300 hover:text-red-400 transition-colors border-l border-gray-100"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {cart.length > 0 && (
            <div className="px-4 py-3">
              <div className="bg-gray-50 rounded-2xl p-4">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-500">상품 합계</span>
                  <span className="font-bold">₩{subtotal.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-500">배송비</span>
                  {shippingFee === 0
                    ? <span className="font-bold text-green-600">무료</span>
                    : <span className="font-bold text-gray-700">₩{shippingFee.toLocaleString()}</span>}
                </div>
                {shippingFee > 0 && (
                  <p className="text-[11px] text-orange-500 mb-2">
                    ₩{(FREE_SHIPPING_MIN - subtotal).toLocaleString()} 더 담으면 무료배송!
                  </p>
                )}
                <div className="border-t border-gray-200 pt-3 flex justify-between">
                  <span className="font-bold text-gray-700">총 결제금액</span>
                  <span className="font-black text-red-500 text-lg">₩{total.toLocaleString()}</span>
                </div>
              </div>
            </div>
          )}

          <div className="h-4" />
        </div>

        <div className="flex-shrink-0 bg-white border-t border-gray-100 px-5 py-4">
          <button
            onClick={() => setStep('form')}
            disabled={cart.length === 0}
            className="w-full text-white font-black py-4 rounded-2xl text-sm shadow-lg active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'linear-gradient(135deg,#ff6a00,#e53935)' }}
          >
            주문서 작성 →
          </button>
        </div>

      </div>
    </div>
  )
}

