'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import ShippingBreakdown from '@/app/components/ShippingBreakdown'
import type { ShippingQuote } from '@/lib/shipping-quote'
import AddressSearchInput from '@/app/components/AddressSearchInput'
import dynamic from 'next/dynamic'
import type { ReviewedConsultation } from '@/lib/consultation-order'

const ConsultationImport = dynamic(() => import('./ConsultationImport'), { ssr: false, loading: () => <p className="py-4 text-sm">상담 가져오기 준비 중…</p> })
type Product = { id: string; name: string; livePrice: number; isVisible?: boolean }

function formatPhone(raw: string) {
  const digits = raw.replace(/\D/g, '').slice(0, 11)
  if (digits.length < 4) return digits
  if (digits.length < 8) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
}

export default function OrderEntry({ onCreated, startImport = false }: { onCreated: () => void; startImport?: boolean }) {
  const [open, setOpen] = useState(startImport)
  const [showImport, setShowImport] = useState(startImport)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [customerRequest, setCustomerRequest] = useState('')
  const [importSourceId, setImportSourceId] = useState('')
  const [importRevision, setImportRevision] = useState(0)
  const [products, setProducts] = useState<Product[]>([])
  const [search, setSearch] = useState('')
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [skipSms, setSkipSms] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [productError, setProductError] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [address, setAddress] = useState('')
  const [addedMessage, setAddedMessage] = useState('')
  const submitting = useRef(false)

  const [chosen, setChosen] = useState<Record<string, Product>>({})
  const [hasMore, setHasMore] = useState(false)
  const [nextOffset, setNextOffset] = useState(0)
  const [submittedSearch, setSubmittedSearch] = useState('')
  const requestRef = useRef<AbortController | null>(null)
  const requestId = useRef(0)

  async function loadProducts(query: string, offset = 0) {
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    const id = ++requestId.current
    setLoading(true)
    setProductError('')
    try {
      const response = await fetch(`/api/admin/order-products?q=${encodeURIComponent(query.trim())}&offset=${offset}`, { cache: 'no-store', signal: controller.signal })
      const data = await response.json()
      if (!response.ok || !Array.isArray(data.products)) throw new Error('상품 조회 실패')
      if (id !== requestId.current) return
      setProducts(prev => offset === 0 ? data.products : Array.from(new Map([...prev, ...data.products].map(p => [p.id, p])).values()))
      setHasMore(data.hasMore)
      setNextOffset(data.nextOffset)
    } catch {
      if (!controller.signal.aborted && id === requestId.current) setProductError('상품 검색에 실패했습니다. 다시 시도해주세요.')
    } finally { if (id === requestId.current) setLoading(false) }
  }

  useEffect(() => {
    return () => { requestRef.current?.abort(); ++requestId.current }
  }, [])

  function runSearch() {
    const query = search.trim()
    requestRef.current?.abort()
    ++requestId.current
    setSubmittedSearch(query)
    setProducts([])
    setHasMore(false)
    setProductError('')
    setLoading(false)
    if (query) void loadProducts(query)
  }
  const selected = Object.values(chosen).filter(p => quantities[p.id] > 0)
  function applyConsultation(draft: ReviewedConsultation) {
    if ((selected.length || name || phone || address || customerRequest) && !confirm('현재 입력한 주문서를 상담 초안으로 바꾸시겠습니까?')) return
    const nextProducts: Record<string, Product> = {}
    const nextQuantities: Record<string, number> = {}
    for (const item of draft.items) {
      nextProducts[item.product.id] = item.product
      nextQuantities[item.product.id] = (nextQuantities[item.product.id] || 0) + item.quantity
      if (nextQuantities[item.product.id] > 999) { setError('같은 상품의 합계 수량이 999개를 초과합니다.'); return }
    }
    setName(draft.name); setPhone(formatPhone(draft.phone)); setAddress([draft.address, draft.detailAddress].filter(Boolean).join(', ')); setCustomerRequest(draft.request)
    setChosen(nextProducts); setQuantities(nextQuantities); setImportSourceId(draft.sourceId)
    setImportRevision(value => value + 1)
    setError(''); setMessage('상담 초안을 반영했습니다. 고객 정보·배송지·합계를 확인한 뒤 주문 등록을 눌러주세요.')
    setShowImport(false); setOpen(true)
  }
  const [quote, setQuote] = useState<ShippingQuote | null>(null)
  const [quotedItems, setQuotedItems] = useState('')
  const selectedSignature = JSON.stringify(selected.map(product => ({ productId: product.id, quantity: quantities[product.id] })))
  const shippingReady = !!quote && quotedItems === selectedSignature
  useEffect(() => {
    let cancelled = false
    setQuotedItems('')
    if (!selected.length || selected.some(product => !Number.isSafeInteger(quantities[product.id]) || quantities[product.id] < 1)) return
    fetch('/api/admin/order-shipping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: JSON.parse(selectedSignature) }) })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); if (!cancelled) { setQuote(data); setQuotedItems(selectedSignature); setError('') } })
      .catch(error => { if (!cancelled) setError(error.message || '배송비 조회 실패') })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSignature])
  const subtotal = shippingReady ? quote.subtotal : selected.reduce((sum, product) => sum + product.livePrice * quantities[product.id], 0)
  const shipping = shippingReady ? quote.shippingFee : 0
  const inputClass = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm'

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    if (!shippingReady) { setError('배송비 확인 후 다시 시도해주세요.'); return }
    if (!selected.length) { setError('주문 상품을 한 개 이상 선택해주세요.'); return }
    if (!address.trim()) { setError('배송 주소를 입력하거나 검색해서 선택해주세요.'); return }
    if (address.length > 500) { setError('배송 주소는 500자 이내로 입력해주세요.'); return }
    const form = event.currentTarget
    submitting.current = true
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch('/api/admin/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, address, request: customerRequest, skipSms, expectedTotal: quote.total, ...(importSourceId ? { importSourceId } : {}), items: selected.map(p => ({ productId: p.id, quantity: quantities[p.id] })) }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || '주문 등록에 실패했습니다.')
      setMessage(`주문 #${result.order.id.slice(0, 8).toUpperCase()} 등록 완료. ${skipSms ? '고객·관리자 문자 발송을 제외했습니다.' : result.sms?.sent ? '주문 문자를 발송했습니다.' : '문자는 발송되지 않았습니다. 주문은 정상 등록되었으니 다시 등록하지 마세요.'}`)
      form.reset()
      setQuantities({})
      setChosen({})
      setName(''); setPhone(''); setCustomerRequest(''); setImportSourceId('')
      setAddress('')
      setAddedMessage('')
      setSearch('')
      setSubmittedSearch('')
      setProducts([])
      setHasMore(false)
      setSkipSms(false)
      setOpen(false)
      onCreated()
    } catch (e) {
      setError(e instanceof Error ? e.message : '응답을 확인하지 못했습니다. 중복 주문 방지를 위해 주문 목록을 확인한 후 다시 시도해주세요.')
    } finally { submitting.current = false; setBusy(false) }
  }

  return <section className="mb-6 rounded-2xl border border-orange-200 bg-white p-4 shadow-sm">
    <div className="flex items-center justify-between gap-3">
      <div><h2 className="font-extrabold text-gray-900">관리자 직접 주문</h2><p className="mt-1 text-xs text-gray-500">숨긴 상품도 검색해서 관리자 주문을 등록할 수 있습니다.</p></div>
      <button type="button" disabled={busy} onClick={() => setOpen(!open)} className="shrink-0 rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{open ? '접기' : '+ 주문 등록'}</button>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <button type="button" disabled={busy} onClick={() => setShowImport(!showImport)} className="rounded-lg border border-indigo-300 px-3 py-2 text-sm font-bold text-indigo-700">캡처·문자로 주문 가져오기</button>
      <a href="/admin/orders/import" className="text-xs text-indigo-600 underline">휴대폰 업로드 전용 화면</a>
    </div>
    {showImport && <ConsultationImport onApply={applyConsultation} onClose={() => setShowImport(false)} />}
    {message && <p role="status" className="mt-3 rounded-xl bg-green-50 p-3 text-sm text-green-800">{message}</p>}
    {open && <form onSubmit={submit} className="mt-4">
      <fieldset disabled={busy} className="space-y-4 disabled:opacity-60">
        {importSourceId && <p className="rounded-lg bg-indigo-50 p-3 text-sm text-indigo-800">상담에서 가져온 주문입니다. 동일한 원본의 중복 등록을 확인합니다.</p>}
        <label className="block text-sm font-bold">상품 검색<input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (!e.nativeEvent.isComposing) runSearch() } }} placeholder="키워드 검색 (예: 인덕션 냄비)" maxLength={100} className={`${inputClass} mt-1`} /></label>
        <button type="button" onClick={runSearch} disabled={loading || !search.trim()} className="rounded-lg bg-orange-500 px-5 py-2 text-sm font-bold text-white disabled:opacity-50">검색</button>
        {loading ? <p className="text-sm text-gray-500">상품을 불러오는 중입니다.</p> : productError ? <div role="alert" className="text-sm text-red-600">{productError} <button type="button" onClick={() => { void loadProducts(submittedSearch) }} className="underline">다시 불러오기</button></div> : <div className="max-h-56 overflow-y-auto rounded-xl border border-gray-200 divide-y">
          {products.map(p => <div key={p.id} className="flex items-center justify-between gap-3 p-3">
            <div className="min-w-0"><p className="break-words text-sm font-semibold">{p.name}{p.isVisible === false && <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">숨김</span>}</p><p className="text-xs text-gray-500">₩{p.livePrice.toLocaleString()}</p></div>
            <button type="button" onClick={() => { setChosen(prev => ({ ...prev, [p.id]: p })); setQuantities(q => ({ ...q, [p.id]: Math.min(999, (q[p.id] || 0) + 1) })); setAddedMessage(`${p.name} · ${Math.min(999, (quantities[p.id] || 0) + 1)}개 담김`) }} className="shrink-0 rounded-lg border border-orange-200 px-3 py-2 text-xs font-bold text-orange-600">담기{quantities[p.id] ? ` (${quantities[p.id]})` : ''}</button>
          </div>)}
          {submittedSearch && products.length === 0 && <p className="p-4 text-sm text-gray-500">검색된 상품이 없습니다.</p>}
        </div>}
        {!submittedSearch && <p className="text-sm text-gray-500">상품 키워드를 입력한 뒤 검색을 눌러주세요. 예: 냄비, 팬, 인덕션</p>}
        {hasMore && <button type="button" disabled={loading} onClick={() => { void loadProducts(submittedSearch, nextOffset) }} className="w-full rounded-lg border py-2 text-sm font-bold disabled:opacity-50">검색 결과 더 보기</button>}
        <p role="status" className="text-sm font-semibold text-green-700">{addedMessage}</p>
        {selected.length > 0 && <div className="space-y-3 rounded-xl bg-gray-50 p-3">
          {selected.map(p => <div key={p.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 break-words font-semibold">{p.name}</span>
            <input aria-label={`${p.name} 수량`} type="number" min="1" max="999" required value={quantities[p.id] || ''} onChange={e => setQuantities(q => ({ ...q, [p.id]: Math.max(1, Math.min(999, Math.floor(Number(e.target.value) || 1))) }))} className="w-20 rounded-lg border px-2 py-2" />
            <span>₩{(p.livePrice * quantities[p.id]).toLocaleString()}</span>
            <button type="button" onClick={() => setQuantities(q => { const next = { ...q }; delete next[p.id]; return next })} className="text-red-500">삭제</button>
          </div>)}
          {shippingReady && <ShippingBreakdown groups={quote.groups} />}
          <p className="border-t pt-3 text-sm">상품 ₩{subtotal.toLocaleString()} + 배송비 ₩{shipping.toLocaleString()} <strong className="block mt-1 text-orange-600">합계 ₩{(subtotal + shipping).toLocaleString()}</strong></p>
          <p className="text-xs text-gray-500">5만원 이상 무료배송 · 미만 4,000원 / 입금대기로 등록됩니다.</p>
        </div>}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-bold">주문자 이름<input name="name" value={name} onChange={e => setName(e.target.value)} autoComplete="name" required maxLength={100} className={`${inputClass} mt-1`} /></label>
          <label className="text-sm font-bold">전화번호<input name="phone" value={phone} onChange={e => setPhone(formatPhone(e.target.value))} type="tel" autoComplete="tel" required placeholder="010-1234-5678" className={`${inputClass} mt-1`} /></label>
          <div className="sm:col-span-2"><p className="mb-2 text-sm font-bold">배송 주소</p><AddressSearchInput key={`${importSourceId || 'manual'}-${importRevision}`} value={address} onChange={setAddress} inputClassName={inputClass} preferSearch compact /></div>
          <label className="text-sm font-bold sm:col-span-2">배송 요청사항 (선택)<textarea name="request" value={customerRequest} onChange={e => setCustomerRequest(e.target.value)} maxLength={1000} rows={2} className={`${inputClass} mt-1`} /></label>
        </div>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-amber-50 p-4">
          <input type="checkbox" checked={skipSms} onChange={e => setSkipSms(e.target.checked)} className="mt-1 h-5 w-5 accent-orange-500" />
          <span className="text-sm font-bold">문자 발송 제외<span className="mt-1 block text-xs font-normal text-gray-600">체크하면 고객과 관리자 모두에게 주문 접수 문자를 보내지 않습니다.</span></span>
        </label>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <button disabled={busy || !selected.length || !shippingReady} className="w-full rounded-xl bg-orange-500 py-3 font-bold text-white disabled:opacity-50">{busy ? '주문 등록 중…' : `₩${(subtotal + shipping).toLocaleString()} 주문 등록${skipSms ? ' (문자 제외)' : ' 및 문자 발송'}`}</button>
      </fieldset>
    </form>}
  </section>
}



