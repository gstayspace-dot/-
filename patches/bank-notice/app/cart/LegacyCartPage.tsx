'use client'
import { customerBack, allowCustomerDeparture, withCustomerPayment } from '@/lib/customer-navigation'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { marketingEvent, reserveMarketingOrder } from '@/lib/marketing/client'
import ProductSupplierLabel from '@/app/components/ProductSupplierLabel'
import ShippingBreakdown from '@/app/components/ShippingBreakdown'
import type { ShippingQuote, ShippingGroup } from '@/lib/shipping-quote'
import type { ShippingRecommendation } from '@/lib/shipping-server'
import CashReceiptFields, { type CashReceiptInput } from '@/app/components/CashReceiptFields'
import AddressSearchInput from '@/app/components/AddressSearchInput'
import { BANK_INFO, BUSINESS_INFO } from '@/lib/business-info'
import {
  getCart, setItemQuantity, removeFromCart, clearCart,
  getCartTotal, addToCart, replaceCart, type CartItem,
} from '@/lib/cart-store'

type Step = 'cart' | 'form' | 'done'

const BANK_NAME = BANK_INFO.name
const BANK_ACCOUNT = BANK_INFO.account
const BANK_HOLDER = BANK_INFO.holder
const TOSS_SCRIPT_URL = 'https://js.tosspayments.com/v2/standard'

type TossWidgets = {
  setAmount: (amount: { value: number; currency: 'KRW' }) => Promise<void> | void
  renderPaymentMethods: (params: { selector: string; variantKey?: string }) => Promise<void> | void
  renderAgreement: (params: { selector: string }) => Promise<void> | void
  requestPayment: (params: {
    orderId: string
    orderName: string
    successUrl: string
    failUrl: string
    customerName?: string
    customerMobilePhone?: string
  }) => Promise<void> | void
}

type TossPaymentsFactory = (clientKey: string) => {
  widgets: (params: { customerKey: string }) => TossWidgets
}

declare global {
  interface Window {
    TossPayments?: TossPaymentsFactory
  }
}

function newCheckoutId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128
  const hex = Array.from(bytes, value => value.toString(16).padStart(2,'0')).join('')
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`
}
function getOrderName(cart: CartItem[]) {
  if (cart.length === 0) return '주문 상품'
  const first = cart[0]?.productName ?? '주문 상품'
  return cart.length > 1 ? `${first} 외 ${cart.length - 1}건` : first
}

export default function CartPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('cart')
  const [cart, setCart] = useState<CartItem[]>([])
  const [shippingQuote, setShippingQuote] = useState<ShippingQuote | null>(null)
  const [quotedSignature, setQuotedSignature] = useState('')
  const [shippingError, setShippingError] = useState('')
  const [quoteAttempt, setQuoteAttempt] = useState(0)
  const [recommendations, setRecommendations] = useState<Record<string, ShippingRecommendation[]>>({})
  const [doneShippingGroups, setDoneShippingGroups] = useState<ShippingGroup[]>([])
  const cartSignature = JSON.stringify(cart.map(item => [item.productId, item.quantity]))
  const shippingReady = !!shippingQuote && quotedSignature === cartSignature
  useEffect(() => {
    let cancelled = false
    setQuotedSignature(''); setShippingError('')
    if (cart.some(item => item.commerceVersion === 2)) { setShippingError('선택 상품은 보관되어 있습니다. 새 주문 시스템 활성화 후 결제해 주세요.'); return }
    if (!cart.length) { setShippingQuote(null); setRecommendations({}); return }
    fetch('/api/cart/shipping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: cart.map(item => ({ productId: item.productId, quantity: item.quantity })) }) })
      .then(async response => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || '배송비를 확인하지 못했습니다.')
        if (cancelled) return
        replaceCart(data.cart); setCart(data.cart); setShippingQuote(data); setRecommendations(data.recommendations ?? {}); setQuotedSignature(cartSignature)
      }).catch(error => { if (!cancelled) setShippingError(error instanceof Error ? error.message : '배송비 확인 실패') })
    return () => { cancelled = true }
    // Server-refreshed names/prices do not change cart identity or quantities.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartSignature, quoteAttempt])

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [request, setRequest] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [orderId, setOrderId] = useState('')
  const [doneCart, setDoneCart] = useState<CartItem[]>([])
  const [doneTotal, setDoneTotal] = useState(0)
  const [payMethod, setPayMethod] = useState<'bank' | 'card' | 'payapp'>('bank')
  const [receiptReady, setReceiptReady] = useState(false)
  const [receipt, setReceipt] = useState<CashReceiptInput>({ requested: false, purpose: 'income', identifier: '' })
  const [payappEnabled, setPayappEnabled] = useState(false)
  const [payappBusy, setPayappBusy] = useState(false)
  const payappRequestId = useRef<string | null>(null)
  const bankRequestId = useRef<string | null>(null)
  const [tossBusy, setTossBusy] = useState(false)
  const [tossError, setTossError] = useState('')
  const [tossReady, setTossReady] = useState(false)
  const [captureMode, setCaptureMode] = useState(false)
  const paymentMethodsRef = useRef<HTMLDivElement>(null)
  const agreementRef = useRef<HTMLDivElement>(null)
  const tossWidgetsRef = useRef<TossWidgets | null>(null)
  const tossScriptLoadedRef = useRef(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const loaded = getCart()
    setCart(loaded)
    fetch('/api/payapp/request', { cache: 'no-store' }).then(res => res.json()).then(data => { setPayappEnabled(data.enabled === true); setReceiptReady(data.receiptsEnabled === true) }).catch(() => setPayappEnabled(false))
    setCaptureMode(params.get('capture') === '1' || params.get('toss') === '1')
    if (params.get('checkout') === '1' && !loaded.some(i => i.commerceVersion === 2)) {
      setStep('form')
    }
  }, [])

  useEffect(() => { if (step === 'form' && cart.length > 0) marketingEvent('begin_checkout', undefined, cart.map(i => ({ productId: i.productId, quantity: i.quantity }))) }, [step, cart])

  function refresh() { setCart(getCart()) }

  function updateQty(productId: string, qty: number) {
    setItemQuantity(productId, qty); refresh()
  }

  function remove(productId: string) {
    removeFromCart(productId); refresh()
  }

  const hasSelections = cart.some(i => i.commerceVersion === 2)
  const subtotal = shippingReady ? shippingQuote.subtotal : getCartTotal(cart)
  const shippingFee = shippingReady ? shippingQuote.shippingFee : 0
  const total = subtotal + shippingFee
  function addRecommended(product: ShippingRecommendation) {
    try { addToCart({ productId: product.id, productName: product.name, price: product.price, imageUrl: product.imageUrl, stock: product.stock }); refresh() }
    catch (error) { setShippingError(error instanceof Error ? error.message : '상품 담기 실패') }
  }
  const orderName = useMemo(() => getOrderName(cart), [cart])
  const tossEnabled = process.env.NEXT_PUBLIC_ENABLE_TOSS_PAYMENTS === 'true' || captureMode
  const hasTossConfig = Boolean(process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY?.trim() && process.env.NEXT_PUBLIC_APP_URL?.trim())

  function formatPhone(raw: string) {
    const digits = raw.replace(/\D/g, '').slice(0, 11)
    if (digits.length < 4) return digits
    if (digits.length < 8) return `${digits.slice(0, 3)}-${digits.slice(3)}`
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
  }

  async function createOrder(status: string) {
    if (cart.some(item => item.commerceVersion === 2)) throw new Error('새 주문 시스템 활성화 후 결제해 주세요.')
    if (!shippingReady) throw new Error('배송비 확인 후 다시 주문해주세요.')
    const res = await fetch('/api/payapp/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: await reserveMarketingOrder() ?? newCheckoutId(), method: status === '결제대기' ? 'toss' : 'bank', name, phone, address, request, receipt: { requested: false }, expectedTotal: total, items: cart.map(item => ({ productId: item.productId, quantity: item.quantity })) }) })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '주문 저장에 실패했습니다.')
    return data as { orderId: string; fullRequest: string }
  }

  async function handlePayappSubmit() {
    if (cart.some(i => i.commerceVersion === 2)) { setSubmitError('선택 상품은 보관되어 있습니다. 새 주문 시스템 활성화 후 결제해 주세요.'); return }
    if (!payappEnabled || payappBusy) return
    if (!shippingReady) { setSubmitError('배송비 확인 후 다시 시도해주세요.'); return }
    if (!name.trim() || !/^01\d{8,9}$/.test(phone.replace(/\D/g, '')) || !address.trim()) {
      setSubmitError('이름, 휴대전화번호, 배송 주소를 확인해주세요.')
      return
    }
    setSubmitError('')
    setPayappBusy(true)
    try {
      const pendingRaw = sessionStorage.getItem('living_payapp_pending')
      if (pendingRaw) {
        const pending = JSON.parse(pendingRaw)
        if (pending.token) {
          const statusRes = await fetch(`/api/payapp/status?id=${encodeURIComponent(pending.id)}&token=${encodeURIComponent(pending.token)}`, { cache: 'no-store' })
          const status = await statusRes.json()
          if (!statusRes.ok) throw new Error(status.error ?? '이전 결제 상태를 확인하지 못했습니다.')
          if (status.paid) {
            allowCustomerDeparture(); window.location.assign(`/payment/payapp?id=${encodeURIComponent(pending.id)}&token=${encodeURIComponent(pending.token)}`)
            return
          }
          if (['결제취소','결제요청실패'].includes(status.status)) {
            sessionStorage.removeItem('living_payapp_pending')
            payappRequestId.current = null
          } else {
            if (pending.payurl) {
              const url = new URL(pending.payurl)
              if (url.protocol !== 'https:' || !(url.hostname === 'payapp.kr' || url.hostname.endsWith('.payapp.kr'))) throw new Error('이전 결제창 주소를 확인할 수 없습니다.')
              allowCustomerDeparture(); window.location.assign(url.toString()); return
            }
            allowCustomerDeparture(); window.location.assign(`/payment/payapp?id=${encodeURIComponent(pending.id)}&token=${encodeURIComponent(pending.token)}`)
            return
          }
        } else {
          throw new Error('이전 결제 요청 결과를 확인하지 못했습니다. 내 주문에서 확인 후 다시 진행해주세요.')
        }
      }
      if (!payappRequestId.current) payappRequestId.current = await reserveMarketingOrder() ?? newCheckoutId()
      sessionStorage.setItem('living_payapp_pending', JSON.stringify({ id: payappRequestId.current }))
      const res = await fetch('/api/payapp/request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: payappRequestId.current, name, phone, address, request, receipt: { requested: false }, expectedTotal: total, items: cart.map(item => ({ productId: item.productId, quantity: item.quantity })) }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.pending && data.token) sessionStorage.setItem('living_payapp_pending', JSON.stringify({ id: data.orderId, token: data.token, cartSnapshot: localStorage.getItem('tlc_cart_v1') }))
        // Validation errors occur before an order exists; ambiguous failures keep
        // the pending marker to stop accidental duplicate payment requests.
        if ([400, 403, 503].includes(res.status) || data.retrySafe === true) { sessionStorage.removeItem('living_payapp_pending'); payappRequestId.current = null }
        throw new Error(data.error ?? '페이앱 결제 요청에 실패했습니다.')
      }
      sessionStorage.setItem('living_payapp_pending', JSON.stringify({ id: data.orderId, token: data.token, payurl: data.payurl, cartSnapshot: localStorage.getItem('tlc_cart_v1') }))
      allowCustomerDeparture(); window.location.assign(data.payurl)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '페이앱 결제 요청에 실패했습니다.')
      setPayappBusy(false)
    }
  }
  async function handleBankSubmit() {
    if (cart.some(i => i.commerceVersion === 2)) { setSubmitError('선택 상품은 보관되어 있습니다. 새 주문 시스템 활성화 후 결제해 주세요.'); return }
    if (submitting) return
    if (!shippingReady) { setSubmitError('배송비 확인 후 다시 시도해주세요.'); return }
    if (!name.trim() || !phone.trim() || !address.trim()) {
      setSubmitError('이름, 전화번호, 배송 주소는 필수 입력 항목입니다.')
      return
    }
    setSubmitError('')
    setSubmitting(true)
    try {
      let savedOrder: { orderId: string; fullRequest: string }
      {
        const res = await fetch('/api/payapp/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: bankRequestId.current ?? (bankRequestId.current = await reserveMarketingOrder() ?? newCheckoutId()), method: 'bank', name, phone, address, request, receipt, expectedTotal: total, items: cart.map(item => ({ productId: item.productId, quantity: item.quantity })) }) })
        const data = await res.json()
        if (!res.ok) { if (data.retrySafe) { bankRequestId.current = null; setQuoteAttempt(value => value + 1) }; throw new Error(data.error ?? '주문 저장에 실패했습니다.') }
        savedOrder = data
      }
      const { orderId, fullRequest } = savedOrder

      fetch('/api/notifications/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          customerName: name.trim(),
          customerPhone: phone.trim(),
          customerAddress: address.trim(),
          customerRequest: fullRequest,
          totalPrice: total,
          paymentMethod: payMethod,
          items: cart.map((i: CartItem) => ({
            productName: i.productName,
            quantity: i.quantity,
          })),
        }),
      }).catch(error => console.error('order notification request failed', error))

      setDoneShippingGroups(shippingQuote?.groups ?? [])
      setDoneCart([...cart])
      setDoneTotal(total)
      setOrderId(orderId.slice(0, 8).toUpperCase())
      clearCart()
      setCart([])
      setStep('done')
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : '주문 중 오류가 발생했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  const ensureTossWidgets = useCallback(async (): Promise<TossPaymentsFactory | null> => {
    if (typeof window === 'undefined') return null
    if (window.TossPayments) return window.TossPayments
    if (tossScriptLoadedRef.current) {
      return new Promise<TossPaymentsFactory | null>((resolve, reject) => {
        const startedAt = Date.now()
        const timer = setInterval(() => {
          if (window.TossPayments) {
            clearInterval(timer)
            resolve(window.TossPayments)
            return
          }
          if (Date.now() - startedAt > 10000) {
            clearInterval(timer)
            reject(new Error('토스 결제 스크립트를 불러오지 못했습니다.'))
          }
        }, 100)
      })
    }
    tossScriptLoadedRef.current = true

    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = TOSS_SCRIPT_URL
      script.async = true
      script.onload = () => resolve()
      script.onerror = () => reject(new Error('토스 결제 스크립트를 불러오지 못했습니다.'))
      document.head.appendChild(script)
    })

    return window.TossPayments ?? null
  }, [])

  const renderTossWidgets = useCallback(async (amount: number) => {
    const TossPayments = await ensureTossWidgets()
    const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY?.trim()
    if (!TossPayments || !clientKey) throw new Error('토스 결제 설정이 아직 준비되지 않았습니다.')

    const widgets = TossPayments(clientKey).widgets({
      customerKey: window.localStorage.getItem('tlc_toss_customer_key') ?? (() => {
        const key = crypto.randomUUID()
        window.localStorage.setItem('tlc_toss_customer_key', key)
        return key
      })(),
    })

    await widgets.setAmount({ value: amount, currency: 'KRW' })
    await widgets.renderPaymentMethods({
      selector: '#toss-payment-methods',
      variantKey: 'DEFAULT',
    })
    await widgets.renderAgreement({ selector: '#toss-agreement' })

    tossWidgetsRef.current = widgets
    setTossReady(true)
  }, [ensureTossWidgets])

  async function handleTossSubmit() {
    if (cart.some(i => i.commerceVersion === 2)) { setSubmitError('선택 상품은 보관되어 있습니다. 새 주문 시스템 활성화 후 결제해 주세요.'); return }
    if (!tossEnabled) {
      setSubmitError('토스 결제는 아직 준비 중입니다.')
      return
    }
    if (!name.trim() || !phone.trim() || !address.trim()) {
      setSubmitError('이름, 전화번호, 배송 주소는 필수 입력 항목입니다.')
      return
    }
    if (!process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY?.trim() || !process.env.NEXT_PUBLIC_APP_URL?.trim()) {
      setSubmitError('토스 결제 환경변수가 아직 설정되지 않았습니다.')
      return
    }
    setSubmitError('')
    setTossError('')
    setTossBusy(true)

    try {
      const { orderId } = await createOrder('결제대기')
      const origin = window.location.origin
      const successUrl = `${origin}/payment/toss/success`
      const failUrl = `${origin}/payment/toss/fail`

      if (!tossWidgetsRef.current) {
        await renderTossWidgets(total)
      }

      const widgets = tossWidgetsRef.current
      if (!widgets) throw new Error('토스 결제 위젯을 불러오지 못했습니다.')

      await withCustomerPayment(() => widgets.requestPayment({
        orderId,
        orderName,
        successUrl,
        failUrl,
        customerName: name.trim(),
        customerMobilePhone: phone.replace(/\D/g, ''),
      }))
    } catch (e) {
      setTossError(e instanceof Error ? e.message : '토스 결제 요청에 실패했습니다.')
      setTossBusy(false)
    }
  }

  useEffect(() => {
    if (!tossEnabled || payMethod !== 'card') return
    if (!name.trim() || !phone.trim() || !address.trim()) return
    if (!hasTossConfig && captureMode) {
      setTossError('')
      setTossReady(true)
      return
    }
    if (!hasTossConfig) {
      setTossError('토스 결제 환경변수가 아직 설정되지 않았습니다.')
      return
    }

    const paymentMethodsEl = paymentMethodsRef.current
    const agreementEl = agreementRef.current
    let cancelled = false
    renderTossWidgets(total)
      .catch(error => {
        if (cancelled) return
        setTossReady(false)
        setTossError(error instanceof Error ? error.message : '토스 결제 UI를 불러오지 못했습니다.')
      })

    return () => {
      cancelled = true
      tossWidgetsRef.current = null
      if (paymentMethodsEl) paymentMethodsEl.innerHTML = ''
      if (agreementEl) agreementEl.innerHTML = ''
    }
  }, [payMethod, name, phone, address, total, renderTossWidgets, tossEnabled, captureMode, hasTossConfig])

  useEffect(() => {
    if (captureMode && tossEnabled) {
      setPayMethod('card')
    }
  }, [captureMode, tossEnabled])

  // ── STEP: DONE ────────────────────────────────────────────────────────────
  if (hasSelections) return <main className="mx-auto max-w-lg space-y-4 p-5">
    <h1 className="text-xl font-bold">선택한 옵션과 추가상품이 저장되었습니다</h1>
    {cart.map(item => <section key={item.lineId ?? item.productId} className="space-y-2 rounded-xl border p-4">
      <a href={`/product/${item.productId}`} className="block font-bold hover:underline">{item.productName}</a><ProductSupplierLabel name={item.supplierName} /><p>{item.optionLabel}</p><p>수량 {item.quantity}개</p>
      {item.addons?.map(addon => <p key={addon.addonId}>[추가상품] {addon.addonName} · {addon.quantity}개</p>)}
    </section>)}
    <div className="flex justify-between"><span>상품 합계 (추가 구성상품 포함)</span><strong>{subtotal.toLocaleString()}원</strong></div>
    <p>출고지별 배송비와 주문 기능은 준비 중입니다.</p>
    <button type="button" disabled className="w-full rounded-xl bg-gray-200 p-3 text-gray-500">주문서 작성 →</button>
    <a href="/shop">쇼핑 계속하기</a>
  </main>

  if (step === 'done') {
    const doneSubtotal = getCartTotal(doneCart)
    const doneShipping = doneTotal - doneSubtotal
    return (
      <div className="min-h-screen-safe bg-gray-50 flex justify-center">
        <div className="w-full max-w-[480px] md:max-w-3xl bg-white min-h-screen-safe flex flex-col">
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
                    <div className="min-w-0 flex-1 mr-2"><span className="block break-words text-gray-700">{i.productName} × {i.quantity}</span><ProductSupplierLabel name={i.supplierName} historical /></div>
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
                  <span className="text-gray-500">배송비 :</span>
                  {doneShipping === 0
                    ? <span className="font-bold text-green-600">무료</span>
                    : <span className="font-bold text-gray-700">{doneShipping.toLocaleString()}원</span>}
                </div>
                <div className="flex justify-between pt-1.5 border-t border-gray-200">
                  <span className="font-bold text-gray-700">총 결제금액</span>
                  <span className="font-black text-red-500">₩{doneTotal.toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="px-5 pb-4"><ShippingBreakdown groups={doneShippingGroups} /></div>
          <div className="flex-shrink-0 px-5 py-4 pb-[calc(1rem_+_env(safe-area-inset-bottom))] bg-white border-t border-gray-100 space-y-2">
            <button
              onClick={() => router.push('/my-orders')}
              className="w-full font-black py-3 rounded-2xl text-sm border-2 border-orange-300 text-orange-500 hover:bg-orange-50 active:scale-95 transition-all"
            >
              📦 내 주문 내역 확인
            </button>
            <button
              onClick={() => router.push('/living-live')}
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
        <div className="w-full max-w-[480px] md:max-w-3xl bg-white min-h-screen-safe flex flex-col">

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
                    <div className="min-w-0 flex-1 mr-2"><span className="block break-words text-gray-600">{i.productName} × {i.quantity}</span><ProductSupplierLabel name={i.supplierName} loading={!shippingReady} /></div>
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
                  <span className="text-gray-500">배송비 : {shippingReady ? '' : '(확인 중)'}</span>
                  {!shippingReady ? <span className="text-gray-400">계산 중</span> : shippingFee === 0
                    ? <span className="font-bold text-green-600">무료</span>
                    : <span className="font-bold text-gray-700">{shippingFee.toLocaleString()}원</span>}
                </div>
                <div className="flex justify-between pt-1 border-t border-gray-200">
                  <span className="text-sm font-bold text-gray-700">총 결제금액</span>
                  <span className="font-black text-red-500">₩{total.toLocaleString()}</span>
                </div>
              </div>
            </div>

          {shippingError && <div role="alert" className="m-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600">{shippingError} <button type="button" className="underline" onClick={() => setQuoteAttempt(value => value + 1)}>배송비 다시 확인</button></div>}
          {!shippingReady && !shippingError && cart.length > 0 && <p className="px-5 py-3 text-sm text-gray-500">배송처별 배송비를 확인하고 있습니다…</p>}
            {shippingReady && <div className="px-5 pb-4"><ShippingBreakdown groups={shippingQuote.groups} /></div>}
            {/* Payment method */}
            <div className="px-5 py-4 bg-white border-b border-gray-100">
              <p className="text-xs font-bold text-gray-600 mb-3">결제 수단</p>
              <div className="flex gap-2">
                {(['bank', 'payapp'] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => {
                      if (m === 'payapp' && !payappEnabled) return
                      setPayMethod(m)
                    }}
                    disabled={m === 'payapp' && !payappEnabled}
                    className={`flex-1 py-3 rounded-xl text-sm font-bold border-2 transition-all ${
                      (m === 'payapp' && !payappEnabled)
                        ? 'border-gray-200 text-gray-300 bg-gray-50 cursor-not-allowed'
                        : payMethod === m
                        ? 'border-orange-400 bg-orange-50 text-orange-600'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}
                  >
                    {m === 'bank' ? '🏦 계좌이체' : payappEnabled ? '💳 신용카드 결제' : '💳 신용카드 준비중'}
                  </button>
                ))}
              </div>

              {payMethod === 'bank' && <p className="mt-3 rounded-xl border-2 border-orange-300 bg-orange-50 px-4 py-3 text-base font-bold leading-relaxed text-orange-900" role="status">주문 접수 후 <strong className="font-extrabold">계좌정보가 문자로 자동 발송됩니다.</strong></p>}
              {payMethod === 'payapp' && <p className="mt-4 rounded-xl bg-orange-50 p-4 text-sm text-orange-700">결제창에서 이용 가능한 카드·간편결제를 선택하세요. 결제 완료 후 주문 내역에 반영됩니다.</p>}
              {tossEnabled && payMethod === 'card' && (
                <div className="mt-4 space-y-4">
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-4">
                    <p className="text-sm font-bold text-emerald-700 mb-1">💳 토스 카드결제</p>
                    <p className="text-xs text-emerald-600 leading-relaxed">
                      아래 결제 UI에서 카드와 간편결제를 선택한 뒤 결제 버튼을 누르면 토스 결제창으로 이동합니다.
                    </p>
                  </div>

                  {!hasTossConfig && captureMode ? (
                    <div className="space-y-3">
                      <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-700 font-medium">
                        로컬 캡처 미리보기 모드입니다. 실제 토스 위젯은 테스트 클라이언트 키가 설정되면 자동으로 표시됩니다.
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="rounded-2xl border border-gray-200 bg-white p-4">
                          <p className="text-xs font-bold text-gray-500 mb-2">결제 수단</p>
                          <div className="space-y-2">
                            <div className="rounded-xl border border-gray-200 px-3 py-3 text-sm font-semibold text-gray-700">카드</div>
                            <div className="rounded-xl border border-gray-200 px-3 py-3 text-sm font-semibold text-gray-700">간편결제</div>
                          </div>
                        </div>
                        <div className="rounded-2xl border border-gray-200 bg-white p-4">
                          <p className="text-xs font-bold text-gray-500 mb-2">약관 동의</p>
                          <div className="rounded-xl border border-gray-200 px-3 py-3 text-sm text-gray-600 leading-relaxed">
                            결제 서비스 이용약관, 개인정보 수집 및 이용, 전자금융거래 약관
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      {tossError && (
                        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600 font-medium">
                          {tossError}
                        </div>
                      )}

                      {!tossReady && (
                        <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-500">
                          결제 UI를 불러오는 중입니다.
                        </div>
                      )}

                      <div className="space-y-3">
                        <div>
                          <p className="text-xs font-bold text-gray-600 mb-2">결제 수단</p>
                          <div id="toss-payment-methods" ref={paymentMethodsRef} className="rounded-2xl border border-gray-200 bg-white p-2 min-h-16" />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-gray-600 mb-2">약관 동의</p>
                          <div id="toss-agreement" ref={agreementRef} className="rounded-2xl border border-gray-200 bg-white p-2 min-h-16" />
                        </div>
                      </div>
                    </>
                  )}
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
                <AddressSearchInput
                  value={address}
                  onChange={setAddress}
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

              {payMethod === 'bank' && <CashReceiptFields value={receipt} onChange={setReceipt} ready={receiptReady} payapp={false} />}
              {/* 개인정보 수집·이용 동의 */}
              <div className="border border-gray-200 rounded-xl p-4 bg-gray-50">
                <p className="text-xs font-bold text-gray-700 mb-2">개인정보 수집·이용 동의 <span className="text-red-400">*</span></p>
              <div className="text-[11px] text-gray-500 leading-relaxed space-y-0.5 mb-3 max-h-32 overflow-y-auto pr-1">
                  <p>• <span className="font-semibold text-gray-600">수집 항목:</span> 이름, 연락처, 배송 주소, 주문 정보</p>
                  <p>• <span className="font-semibold text-gray-600">수집 목적:</span> 주문 상품 배송 및 주문·결제 관련 상담</p>
                  <p>• <span className="font-semibold text-gray-600">보유·이용 기간:</span> 관련 법령(전자상거래법)에 따라 거래기록은 5년간 보관 후 파기하며, 그 외 정보는 목적 달성 시 지체 없이 파기합니다.</p>
                  <p>• <span className="font-semibold text-gray-600">개인정보 관리책임자:</span> {BUSINESS_INFO.name} 대표 {BUSINESS_INFO.representative} (☎ {BUSINESS_INFO.phone})</p>
                  <p className="text-gray-400 mt-1">※ 동의를 거부하실 권리가 있으나, 미동의 시 상품 주문 및 배송이 불가능합니다.</p>
                </div>
                <p className="rounded-lg bg-white border border-orange-100 px-3 py-2 text-xs font-bold text-gray-700">
                  주문하기 버튼을 누르면 위 개인정보 수집·이용에 동의하고 주문이 접수됩니다.
                </p>
                <p className="mt-3 text-[11px] text-gray-500 leading-relaxed">
                  <a href="/policy/refund" className="font-bold text-gray-700 hover:text-orange-600 transition-colors">환불/교환 안내</a>
                  &nbsp;·&nbsp;
                  <a href="/policy/privacy" className="font-bold text-gray-700 hover:text-orange-600 transition-colors">개인정보처리방침</a>
                  &nbsp;·&nbsp;
                  <a href="/policy/terms" className="font-bold text-gray-700 hover:text-orange-600 transition-colors">이용약관</a>
                  &nbsp;페이지에서 반품 기준과 개인정보 처리 내용을 확인할 수 있습니다.
                </p>
              </div>
            </div>

            <div className="h-24" />
          </div>

        <div className="flex-shrink-0 bg-white border-t border-gray-100 px-5 py-4 pb-[calc(1rem_+_env(safe-area-inset-bottom))]">
          <button
            onClick={payMethod === 'payapp' ? handlePayappSubmit : payMethod === 'card' && tossEnabled ? handleTossSubmit : handleBankSubmit}
            disabled={submitting || tossBusy || payappBusy || !shippingReady}
            className="w-full text-white font-black py-4 rounded-2xl text-sm shadow-lg active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: 'linear-gradient(135deg,#ff6a00,#e53935)' }}
          >
            {payMethod === 'payapp' ? (payappBusy ? '신용카드 결제창 여는 중...' : `신용카드 결제하기 · ₩${total.toLocaleString()}`) : submitting
              ? '주문 처리 중...'
              : tossEnabled && tossBusy
                ? '토스 결제창 여는 중...'
                : tossEnabled && payMethod === 'card'
                  ? `토스 결제하기 · ₩${total.toLocaleString()}`
                  : `동의하고 주문하기 · ₩${total.toLocaleString()}`}
          </button>
          <p className="mt-2 text-center text-[11px] font-medium text-gray-400">
            버튼을 누르면 개인정보 수집·이용 동의와 주문 접수가 함께 진행됩니다.
          </p>
        </div>
        </div>
      </div>
    )
  }

  // ── STEP: CART ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen-safe bg-gray-50 flex justify-center">
      <div className="w-full max-w-[480px] md:max-w-3xl bg-white min-h-screen-safe flex flex-col">

        <header className="sticky top-0 z-20 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 flex-shrink-0">
          <button
            onClick={() => customerBack(router)}
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
          {shippingError && <div role="alert" className="m-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600">{shippingError} <button type="button" className="underline" onClick={() => setQuoteAttempt(value => value + 1)}>배송비 다시 확인</button></div>}
          {!shippingReady && !shippingError && cart.length > 0 && <p className="px-5 py-3 text-sm text-gray-500">배송처별 배송비를 확인하고 있습니다…</p>}
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 gap-4">
              <span className="text-6xl">🛒</span>
              <p className="text-gray-500 font-semibold">장바구니가 비어있습니다.</p>
              <button
                onClick={() => router.push('/living-live')}
                className="text-orange-500 font-bold underline underline-offset-2 text-sm"
              >
                라이브 보러 가기
              </button>
            </div>
          ) : (
            <div className="px-4 py-4 space-y-3">
              {cart.map(item => (
                <div key={item.productId} className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm flex items-stretch">
                  <a href={`/product/${item.productId}`} aria-label={`${item.productName} 상세보기`} className="w-20 flex-shrink-0 bg-gray-50 flex items-center justify-center overflow-hidden">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt={item.productName} className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <span className="text-3xl">🛍</span>
                    )}
                  </a>
                  <div className="flex-1 px-3 py-3 min-w-0">
                    <a href={`/product/${item.productId}`} className="block text-sm font-bold text-gray-900 leading-tight line-clamp-2 hover:underline">{item.productName}</a>
                    <ProductSupplierLabel name={item.supplierName} loading={!shippingReady} />
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

          {shippingReady && <div className="px-4 py-3"><ShippingBreakdown groups={shippingQuote.groups} recommendations={recommendations} onAdd={addRecommended} /></div>}
          {cart.length > 0 && (
            <div className="px-4 py-3">
              <div className="bg-gray-50 rounded-2xl p-4">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-500">상품 합계</span>
                  <span className="font-bold">₩{subtotal.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-500">배송비 : {shippingReady ? '' : '(확인 중)'}</span>
                  {!shippingReady ? <span className="text-gray-400">계산 중</span> : shippingFee === 0
                    ? <span className="font-bold text-green-600">무료</span>
                    : <span className="font-bold text-gray-700">{shippingFee.toLocaleString()}원</span>}
                </div>
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
            disabled={cart.length === 0 || !shippingReady}
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
