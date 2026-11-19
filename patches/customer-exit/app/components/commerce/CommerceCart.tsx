'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Product } from '@/lib/types'
import type { Quote } from '@/lib/commerce/types'
import { cartItemKey, getCart, appendCartItems, getCartTotal, removePurchasedItems } from '@/lib/cart-store'
import { cartSelections, selectedCartItems, validateProductSelection } from '@/lib/commerce/product-selection'
import { ATTEMPT_KEY, readAttempt, readOrderAccess, saveAttempt, finishAttempt, type CheckoutAttempt, type CheckoutForm, type CommerceConfig, type OrderResult } from '@/lib/commerce/checkout'
import { useCommerceCart } from './useCommerceCart'
import { OrderReceipt, PriceSummary } from './OrderSummary'
import ProductSupplierLabel from '@/app/components/ProductSupplierLabel'
import SupplierRecommendations from './SupplierRecommendations'
import ProductPurchasePanel from './ProductPurchasePanel'
import CommerceCheckout from './CommerceCheckout'
import type { TossPaymentHandle } from './TossPaymentMethods'

const emptyForm: CheckoutForm = { customerName: '', customerPhone: '', customerAddress: '', customerRequest: '', paymentMethod: 'bank' }
class RequestError extends Error { constructor(message: string, public status: number, public code?: string) { super(message) } }
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init })
  const data = await response.json()
  if (!response.ok) throw new RequestError(data.error ?? '요청을 처리하지 못했습니다.', response.status, data.code)
  return data as T
}
export default function CommerceCart({ config }: { config: CommerceConfig }) {
  const router = useRouter()
  const [step, setStep] = useState<'cart' | 'form' | 'done'>('cart')
  const [attempt, setAttempt] = useState<CheckoutAttempt | null>(null), [initializing, setInitializing] = useState(true)
  const [form, setForm] = useState<CheckoutForm>(emptyForm), [done, setDone] = useState<OrderResult | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [adding, setAdding] = useState(false)
  const [modal, setModal] = useState<Product | null>(null), [sdkReady, setSdkReady] = useState(false)
  const sdk = useRef<TossPaymentHandle>(null), submitting = useRef(false)
  const cart = useCommerceCart(initializing || !!attempt || step === 'done' || !config.enabled)
  const onSdkReady = useCallback((ready: boolean) => setSdkReady(ready), [])
  useEffect(() => {
    try {
      const resumeId = new URLSearchParams(window.location.search).get('resume')
      const saved = resumeId ? readOrderAccess(resumeId) : readAttempt()
      if (saved && !saved.completed) { setAttempt(saved); setForm(saved.payload); setStep('form') }
      else if (new URLSearchParams(window.location.search).get('checkout') === '1') setStep('form')
    } catch { setError('주문 저장 공간을 확인해 주세요.') }
    setInitializing(false)
  }, [])
  useEffect(() => {
    if (!modal) return
    const previous = document.activeElement as HTMLElement | null
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !adding) setModal(null)
      if (event.key === 'Tab') {
        const nodes = Array.from(document.querySelectorAll<HTMLElement>('#recommendation-dialog button:not(:disabled), #recommendation-dialog select:not(:disabled), #recommendation-dialog input:not(:disabled), #recommendation-dialog a[href]'))
        const first = nodes[0], last = nodes[nodes.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    document.getElementById('close-recommendation')?.focus()
    document.addEventListener('keydown', close)
    return () => { document.removeEventListener('keydown', close); previous?.focus() }
  }, [modal, adding])
  const displayQuote = attempt?.result?.quote ?? attempt?.reviewQuote ?? cart.quote
  const canCheckout = config.checkoutEnabled && !initializing && !cart.loading && !cart.error && !cart.issues.length && cart.items.length > 0
  const excluded = Array.from(new Set(cart.items.map(i => i.productId))).sort().join(',')
  async function recommend(product: Product) {
    if (adding || busy || attempt) return
    setAdding(true); setError('')
    try {
      const detail = await api<Product>(`/api/products/${product.id}`)
      if (detail.requiresOptions || (detail.options?.length ?? 0) > 0) { setModal(detail); return }
      const selection = [{ lineId: crypto.randomUUID(), productId: detail.id, quantity: 1, addons: [] }]
      validateProductSelection(detail, selection, getCart())
      const quote = await api<Quote>('/api/cart/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [...cartSelections(getCart().filter(i => i.commerceVersion === 2)), ...selection] }) })
      appendCartItems(selectedCartItems(detail, selection, quote))
      await cart.refresh()
    } catch (err) { setError(err instanceof Error ? err.message : '상품을 담지 못했습니다.') }
    finally { setAdding(false) }
  }
  function complete(current: CheckoutAttempt, result: OrderResult) {
    finishAttempt({ ...current, result })
    removePurchasedItems(current.snapshot)
    setDone(result); setAttempt(null); setStep('done')
  }
  async function ensureOrder(current: CheckoutAttempt): Promise<CheckoutAttempt> {
    if (current.result && current.accessToken) return current
    const created = await api<OrderResult & { accessToken: string }>('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': current.key }, body: JSON.stringify(current.payload) })
    const updated = { ...current, result: { order: created.order, quote: created.quote }, accessToken: created.accessToken }
    saveAttempt(updated); setAttempt(updated)
    return updated
  }
  async function submit() {
    if (submitting.current || !config.checkoutEnabled) return
    if (!attempt && !canCheckout) return
    if (form.paymentMethod === 'card' && !sdkReady) { setError('결제창이 준비될 때까지 기다려 주세요.'); return }
    if (!form.customerName.trim() || !/^\d{9,11}$/.test(form.customerPhone.replace(/\D/g, '')) || !form.customerAddress.trim()) { setError('수령인 이름, 올바른 연락처, 배송 주소를 입력해 주세요.'); return }
    submitting.current = true; setBusy(true); setError('')
    let current = attempt
    try {
      if (!current) {
        const payload = { ...form, customerName: form.customerName.trim(), customerPhone: form.customerPhone.trim(), customerAddress: form.customerAddress.trim(), customerRequest: form.customerRequest.trim(), items: cartSelections(cart.items), expectedTotal: cart.quote.total }
        current = { key: crypto.randomUUID(), fingerprint: JSON.stringify(payload), payload, snapshot: cart.items, reviewQuote: cart.quote }
        saveAttempt(current); setAttempt(current)
      }
      current = await ensureOrder(current)
      const latest = await api<OrderResult>(`/api/orders/${current.result!.order.id}`, { headers: { Authorization: `Bearer ${current.accessToken}` } })
      if (latest.order.inventory_state === 'released') throw new Error('취소되었거나 결제 시간이 만료된 주문입니다. 주문을 정리한 뒤 다시 담아 주세요.')
      if (current.payload.paymentMethod === 'bank' || latest.order.payment_status === 'paid') { complete(current, latest); return }
      if (current.paymentKey) { router.push(`/payment/toss/success?orderId=${encodeURIComponent(latest.order.id)}&amount=${current.result!.quote.total}&paymentKey=${encodeURIComponent(current.paymentKey)}`); return }
      if (latest.order.payment_status !== 'pending') throw new Error('이전 결제 결과를 확인 중입니다. 주문 상세에서 상태를 확인해 주세요.')
      if (latest.order.version !== current.result!.order.version || latest.quote.total !== current.result!.quote.total) {
        const updated = { ...current, result: latest, reviewQuote: latest.quote }; saveAttempt(updated); setAttempt(updated)
        throw new Error('주문 내용이 변경되었습니다. 표시된 상품과 금액을 확인한 뒤 다시 결제해 주세요.')
      }
      if (new Date(latest.order.expires_at).getTime() <= Date.now()) throw new Error('결제 시간이 만료되었습니다. 주문을 취소한 뒤 다시 주문해 주세요.')
      if (!sdk.current) throw new Error('결제창을 다시 불러와 주세요.')
      const first = latest.quote.items.find(i => i.kind === 'product')?.productName ?? '리빙라방 주문'
      await sdk.current.request(latest.quote.total, { orderId: latest.order.id, orderName: latest.quote.items.filter(i => i.kind === 'product').length > 1 ? `${first} 외 상품` : first, successUrl: `${location.origin}/payment/toss/success`, failUrl: `${location.origin}/payment/toss/fail?checkoutOrderId=${encodeURIComponent(latest.order.id)}`, customerName: latest.order.recipient_name, customerMobilePhone: latest.order.recipient_phone.replace(/\D/g, '') })
    } catch (err) {
      if (err instanceof RequestError && err.status >= 400 && err.status < 500 && !current?.result) { sessionStorage.removeItem(ATTEMPT_KEY); setAttempt(null); void cart.refresh() }
      setError(err instanceof Error ? err.message : '주문을 처리하지 못했습니다. 같은 주문으로 다시 시도할 수 있습니다.')
    } finally { submitting.current = false; setBusy(false) }
  }
  async function cancel() {
    if (!attempt || submitting.current) return
    submitting.current = true; setBusy(true); setError('')
    try {
      const current = await ensureOrder(attempt)
      await api(`/api/orders/${current.result!.order.id}/cancel`, { method: 'POST', headers: { Authorization: `Bearer ${current.accessToken}` } })
      finishAttempt(current); setAttempt(null); setStep('cart')
    } catch (err) { setError(err instanceof Error ? err.message : '주문 취소 결과를 확인하지 못했습니다.') }
    finally { submitting.current = false; setBusy(false) }
  }
  if (step === 'done' && done) return <main className="mx-auto min-h-screen-safe max-w-lg space-y-5 bg-white p-5"><h1 className="text-xl font-bold">{done.order.payment_status === 'paid' ? '결제가 완료되었습니다' : '입금 주문이 접수되었습니다'}</h1>{done.order.payment_status !== 'paid' && <div className="rounded-xl bg-green-50 p-4 text-sm leading-relaxed">국민은행 233001-04-329449<br />최영진(영진상사)<br />입금액: <strong>{done.quote.total.toLocaleString()}원</strong><br />입금 기한: {new Date(done.order.expires_at).toLocaleString('ko-KR')}<br />주문자명과 입금자명을 동일하게 입력해 주세요.</div>}<OrderReceipt result={done} /><a href={`/order/${done.order.id}`} className="block rounded-xl bg-orange-600 p-3 text-center font-bold text-white">주문 상세 보기</a><a href="/shop" className="block text-center text-sm underline">쇼핑 계속하기</a></main>
  return <main className="mx-auto min-h-screen-safe max-w-lg bg-white">
    <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-gray-100 bg-white px-4 py-3"><button type="button" disabled={busy} onClick={() => step === 'form' && !attempt ? setStep('cart') : router.push('/shop')} className="h-10 rounded-full bg-gray-100 px-3 text-sm">뒤로</button><h1 className="flex-1 text-base font-bold">{step === 'form' ? '주문서 · 통합 결제' : '장바구니'}</h1><a href="/my-orders" className="text-xs text-gray-500 underline">내 주문</a></header>
    <div className="space-y-4 p-4">
      {!config.checkoutEnabled && <p role="status" className="rounded-xl bg-orange-50 p-3 text-sm">주문 기능을 준비 중입니다. 장바구니의 선택 내역은 보관됩니다.</p>}
      {(error || (!attempt && cart.error)) && <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error || cart.error}{!attempt && <button type="button" onClick={() => { setError(''); void cart.refresh() }} className="ml-2 font-bold underline">다시 확인</button>}</div>}
      {!attempt && cart.loading && <p role="status" className="text-xs text-gray-500">상품 재고와 출고지별 배송비를 확인하고 있습니다.</p>}
      {attempt && <div className="space-y-2 rounded-xl bg-orange-50 p-3 text-sm"><p>접수 중인 같은 주문으로 이어갑니다. 상품을 수정하려면 먼저 주문을 취소해 주세요.</p><button type="button" onClick={cancel} disabled={busy} className="font-bold text-orange-800 underline">주문 취소 후 장바구니 수정</button>{attempt.result && <a href={`/order/${attempt.result.order.id}`} className="ml-3 underline">주문 상세</a>}</div>}
      {step === 'form' ? <CommerceCheckout form={form} onChange={setForm} quote={displayQuote} config={config} busy={busy} locked={!!attempt} onSubmit={() => void submit()} sdk={sdk} onSdkReady={onSdkReady} canSubmit={config.checkoutEnabled && (!!attempt || canCheckout) && (form.paymentMethod !== 'card' || sdkReady)} /> : <>
        {cart.issues.map(issue => <div key={cartItemKey(issue.item)} className="space-y-2 rounded-xl border border-red-200 p-3 text-sm"><p className="font-bold">{issue.item.productName}</p><p className="text-red-700">{issue.message}</p><a href={`/product/${issue.item.productId}`} className="mr-4 font-bold underline">상품에서 다시 선택</a><button type="button" onClick={() => cart.remove(cartItemKey(issue.item))} className="text-gray-600 underline">삭제</button></div>)}
        {cart.quote.shippingGroups.map(group => <section key={group.supplierId} aria-label={`${group.supplierName} 장바구니`} className="overflow-hidden rounded-2xl border border-gray-200">
          <h2 className="bg-gray-50 px-4 py-3 text-sm font-bold">{group.supplierName} 출고</h2>
          {cart.items.filter(i => i.supplierId === group.supplierId && !cart.issues.some(issue => issue.item.lineId === i.lineId)).map(item => <div key={cartItemKey(item)} className="space-y-3 border-t border-gray-100 p-4">
            <div className="flex items-start gap-3"><a href={`/product/${item.productId}`} className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-gray-50">{item.imageUrl ? <img src={item.imageUrl} alt={item.productName} className="h-full w-full rounded-xl object-contain" /> : '🛍'}</a><div className="min-w-0 flex-1"><a href={`/product/${item.productId}`} className="block text-sm font-bold">{item.productName}</a><ProductSupplierLabel name={group.supplierName} />{item.optionLabel && <p className="mt-1 text-xs font-semibold text-orange-700">{item.optionLabel}</p>}<p className="mt-1 text-xs text-gray-500">{item.price.toLocaleString()}원 / 개</p></div><button type="button" aria-label={`${item.productName} ${item.optionLabel ?? ''} 삭제`} onClick={() => cart.remove(cartItemKey(item))} className="h-8 w-8 shrink-0 text-gray-500">✕</button></div>
            <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><button type="button" aria-label={`${item.productName} ${item.optionLabel ?? ''} 수량 감소`} disabled={item.quantity <= 1} onClick={() => cart.quantity(cartItemKey(item), item.quantity - 1)} className="h-9 w-9 rounded-lg border disabled:opacity-30">−</button><span className="text-sm font-bold">{item.quantity}</span><button type="button" aria-label={`${item.productName} ${item.optionLabel ?? ''} 수량 증가`} onClick={() => cart.quantity(cartItemKey(item), item.quantity + 1)} className="h-9 w-9 rounded-lg border">+</button></div><strong className="text-sm">{getCartTotal([item]).toLocaleString()}원</strong></div>
            {(item.addons ?? []).map(addon => <div key={addon.addonId} className="rounded-xl bg-gray-50 p-3 text-xs"><p className="mb-2 font-semibold">추가: {addon.addonName} · {(addon.price * addon.quantity).toLocaleString()}원</p><div className="flex items-center gap-2"><button type="button" aria-label={`${addon.addonName} 수량 감소`} disabled={addon.quantity <= 1} onClick={() => cart.addonQuantity(cartItemKey(item), addon.addonId, addon.quantity - 1)} className="h-8 w-8 rounded-lg border bg-white disabled:opacity-30">−</button><span>{addon.quantity}</span><button type="button" aria-label={`${addon.addonName} 수량 증가`} onClick={() => cart.addonQuantity(cartItemKey(item), addon.addonId, addon.quantity + 1)} className="h-8 w-8 rounded-lg border bg-white">+</button><button type="button" aria-label={`${addon.addonName} 삭제`} onClick={() => cart.addonQuantity(cartItemKey(item), addon.addonId, 0)} className="ml-auto underline">삭제</button></div></div>)}
          </div>)}
          <div className="space-y-2 border-t border-gray-100 bg-gray-50 p-4 text-xs"><div className="flex justify-between"><span>상품 소계</span><strong>{group.subtotal.toLocaleString()}원</strong></div><div className="flex justify-between"><span>배송비 :</span><strong>{group.shippingFee ? `${group.shippingFee.toLocaleString()}원` : '무료'}</strong></div><div role="progressbar" aria-label={`${group.supplierName} 무료배송 달성률`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={group.threshold === 0 ? 100 : Math.min(100, Math.floor(group.subtotal / group.threshold * 100))} className="h-2 overflow-hidden rounded-full bg-gray-200"><div className="h-full rounded-full bg-orange-500" style={{ width: `${group.threshold === 0 ? 100 : Math.min(100, group.subtotal / group.threshold * 100)}%` }} /></div><p className={group.remaining ? 'text-gray-600' : 'font-bold text-green-700'}>{group.remaining ? `무료배송까지 ${group.remaining.toLocaleString()}원` : '무료배송 기준을 충족했습니다.'}</p></div>
          {group.remaining > 0 && <SupplierRecommendations group={group} excluded={excluded} busy={adding || busy || cart.loading} onAdd={product => void recommend(product)} />}
        </section>)}
        {!cart.items.length && !cart.loading && <div className="py-16 text-center text-sm text-gray-500">장바구니가 비어 있습니다. <a href="/shop" className="font-bold text-orange-700 underline">상품 보기</a></div>}
        {cart.items.length > 0 && <><PriceSummary quote={cart.quote} /><button type="button" onClick={() => { setError(''); setStep('form') }} disabled={!canCheckout || adding} className="w-full rounded-2xl bg-orange-600 py-4 text-sm font-bold text-white disabled:opacity-40">주문서 작성 · {cart.quote.total.toLocaleString()}원</button></>}
      </>}
    </div>
    {modal && <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-3" onClick={event => { if (event.target === event.currentTarget) setModal(null) }}><div id="recommendation-dialog" role="dialog" aria-modal="true" aria-labelledby="recommendation-title" className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white"><div className="flex items-center gap-2 border-b p-4"><h2 id="recommendation-title" className="flex-1 text-sm font-bold">{modal.name} 옵션 선택</h2><button id="close-recommendation" type="button" onClick={() => setModal(null)} className="h-9 w-9">✕</button></div><ProductPurchasePanel product={modal} onAdded={orderNow => { setModal(null); void cart.refresh(); if (orderNow) setStep('form') }} /></div></div>}
  </main>
}
