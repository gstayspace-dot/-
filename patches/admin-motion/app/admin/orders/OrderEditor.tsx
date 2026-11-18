'use client'
import { useEffect, useRef, useState } from 'react'
import type { DbOrder, DbOrderItem } from '@/lib/supabaseClient'
import ShippingBreakdown from '@/app/components/ShippingBreakdown'
import { buildShippingQuote, type ShippingSupplier } from '@/lib/shipping-quote'
import AddressSearchInput from '@/app/components/AddressSearchInput'
type Order = DbOrder & { items: DbOrderItem[] }
type Item = { supplierId?:string|null; supplierName?:string|null; productId:string; name:string; price:number; quantity:number }
export default function OrderEditor({order,onClose,onSaved}:{order:Order;onClose:()=>void;onSaved:()=>void}) {
  const [customerName,setCustomerName] = useState(order.customer_name)
  const [customerPhone,setCustomerPhone] = useState(order.customer_phone)
  const [customerRequest,setCustomerRequest] = useState(order.customer_request ?? '')
  const [status,setStatus] = useState(order.status)
  const [createdAt,setCreatedAt] = useState(order.created_at)
  const [paymentMethod,setPaymentMethod] = useState(order.payment_method ?? '')
  const [paymentAmount,setPaymentAmount] = useState(order.payment_amount == null ? '' : String(order.payment_amount))
  const [paymentConfirmedAt,setPaymentConfirmedAt] = useState(order.payment_confirmed_at ?? '')
  const [manualTotal,setManualTotal] = useState('')
  const [address,setAddress] = useState(order.customer_address)
  const [items,setItems] = useState<Item[]>(order.items.map(i=>({productId:i.product_id,supplierId:i.supplier_id,supplierName:i.supplier_name,name:i.product_name,price:i.price,quantity:i.quantity})))
  const [search,setSearch] = useState('')
  const [results,setResults] = useState<Array<{id:string;name:string;livePrice:number;isVisible?:boolean;supplierId?:string|null}>>([])
  const [offset,setOffset] = useState(0)
  const [hasMore,setHasMore] = useState(false)
  const [submitted,setSubmitted] = useState('')
  const [loading,setLoading] = useState(false)
  const [busy,setBusy] = useState(false)
  const saving = useRef(false)
  const [error,setError] = useState('')
  const request = useRef(0)
  const changed = JSON.stringify(items.map(i=>[i.productId,i.quantity,i.price]).sort()) !== JSON.stringify(order.items.map(i=>[i.product_id,i.quantity,i.price]).sort())
  const [suppliers, setSuppliers] = useState<ShippingSupplier[]>([])
  const [supplierReady, setSupplierReady] = useState(false)
  useEffect(() => {
    fetch('/api/admin/suppliers', { cache: 'no-store' }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); setSuppliers(data.suppliers); setSupplierReady(true) }).catch(error => setError(error.message || '배송처 조회 실패'))
  }, [])
  let quote = null
  try { if (supplierReady && items.length) quote = buildShippingQuote(items.map(item => ({ productId: item.productId, supplierId: item.supplierId ?? null, price: item.price, quantity: item.quantity })), suppliers.map(supplier => ({ ...supplier, name: items.find(item => item.supplierId === supplier.id)?.supplierName ?? supplier.name }))) } catch { /* Invalid quantities are handled by the save button. */ }
  const total = changed ? quote?.total ?? 0 : order.total_price
  async function findProducts(append=false) {
    const q = append ? submitted : search.trim()
    if(!q) {setResults([]);setHasMore(false);return}
    const id=++request.current;setLoading(true);setError('')
    try {
      const res=await fetch(`/api/admin/order-products?q=${encodeURIComponent(q)}&offset=${append ? offset : 0}`,{cache:'no-store'})
      const data=await res.json();if(id!==request.current)return
      if(!res.ok)throw new Error(data.error || '상품 검색 실패')
      setResults(prev=>append ? [...prev,...data.products] : data.products);setOffset(data.nextOffset);setHasMore(data.hasMore);setSubmitted(q)
    }catch(err){if(id===request.current)setError(err instanceof Error ? err.message : '상품 검색 실패')}
    finally{if(id===request.current)setLoading(false)}
  }
  async function save() {
    if(saving.current)return
    saving.current=true;setBusy(true);setError('')
    try {
      const res=await fetch('/api/admin/orders/edit',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:order.id,address,customerName,customerPhone,customerRequest,status,createdAt,paymentMethod,paymentAmount:paymentAmount===''?null:Number(paymentAmount),paymentConfirmedAt:paymentConfirmedAt||null,totalOverride:manualTotal === '' ? undefined : Number(manualTotal),items:items.map(i=>({productId:i.productId,quantity:i.quantity,price:i.price,name:i.name,supplierId:i.supplierId ?? null})),expected:order})})
      const data=await res.json();if(!res.ok)throw new Error(data.error || '저장 실패')
      onSaved()
    }catch(err){setError(err instanceof Error ? err.message : '저장 실패')}
    finally{saving.current=false;setBusy(false)}
  }
  return <div className="fixed inset-0 z-50 bg-black/40 overflow-y-auto p-3 sm:p-8" onClick={e=>{if(e.target===e.currentTarget&&!busy)onClose()}}>
    <section role="dialog" aria-modal="true" aria-label="주문 수정" className="mx-auto max-w-2xl rounded-2xl bg-white p-5 sm:p-7 shadow-xl">
      <div className="flex justify-between items-center mb-5"><h2 className="font-black text-lg">주문정보 전체 수정</h2><button disabled={busy} onClick={onClose} aria-label="닫기" className="p-2">✕</button></div>
      <p className="text-sm mb-4">{order.customer_name} · #{order.id.slice(0,8)}</p>
      <fieldset disabled={busy} className="space-y-4">
        <div className="grid grid-cols-2 gap-3"><label className="text-sm">주문자 / 수령인<input aria-label="주문자 이름" value={customerName} onChange={e=>setCustomerName(e.target.value)} className="mt-1 w-full border rounded p-2" /></label><label className="text-sm">연락처<input aria-label="주문자 연락처" value={customerPhone} onChange={e=>setCustomerPhone(e.target.value)} className="mt-1 w-full border rounded p-2" /></label></div>
        <label className="block text-sm">요청사항 / 메모<textarea aria-label="주문 요청사항" value={customerRequest} onChange={e=>setCustomerRequest(e.target.value)} className="mt-1 w-full border rounded p-2" /></label>
        <div className="grid grid-cols-2 gap-3"><label className="text-sm">주문 상태<select aria-label="주문 상태" value={status} onChange={e=>setStatus(e.target.value)} className="mt-1 w-full border rounded p-2">{Array.from(new Set([order.status,'입금대기','결제대기','결제완료','배송중','배송완료','취소','결제취소','환불확인필요'])).map(s=><option key={s}>{s}</option>)}</select></label><label className="text-sm">결제 방식<input aria-label="결제 방식" disabled={!!order.payment_key} value={paymentMethod} onChange={e=>setPaymentMethod(e.target.value)} className="mt-1 w-full border rounded p-2 disabled:bg-gray-100" /></label></div>
        <div className="grid grid-cols-2 gap-3"><label className="text-sm">기록된 결제 / 입금액 (원)<input aria-label="결제 입금액" type="number" min={0} step={1} disabled={!!order.payment_key} value={paymentAmount} onChange={e=>setPaymentAmount(e.target.value)} className="mt-1 w-full border rounded p-2 disabled:bg-gray-100" /></label><label className="text-sm">입금 확인 일시<input aria-label="입금 확인 일시" disabled={!!order.payment_key} value={paymentConfirmedAt} onChange={e=>setPaymentConfirmedAt(e.target.value)} placeholder="2026-11-16T15:00:00+09:00" className="mt-1 w-full border rounded p-2 disabled:bg-gray-100" /></label></div>
        {order.payment_key && <p className="text-xs text-gray-500">결제 거래번호: {order.payment_key} · 결제 승인 기록은 결제사에서 관리합니다.</p>}
        <label className="block text-sm">주문일시 (시간대 포함)<input aria-label="주문일시" value={createdAt} onChange={e=>setCreatedAt(e.target.value)} className="mt-1 w-full border rounded p-2" /></label>
        <div><p className="font-bold text-sm mb-2">배송 주소</p><AddressSearchInput value={address} onChange={setAddress} defaultManual /></div>
        <div><p className="font-bold text-sm mb-2">주문 상품</p><div className="space-y-3">{items.map(item=><div key={item.productId} className="flex items-center gap-2 text-sm border rounded-lg p-2"><div className="flex-1 min-w-0"><input aria-label="주문 상품명" value={item.name} onChange={e=>setItems(prev=>prev.map(i=>i.productId===item.productId?{...i,name:e.target.value}:i))} className="w-full border rounded p-1"/><label className="text-xs">단가 (원)<input type="number" min={0} step={1} aria-label={`${item.name} 단가`} value={item.price} onChange={e=>setItems(prev=>prev.map(i=>i.productId===item.productId?{...i,price:Number(e.target.value)}:i))} className="w-full border rounded p-1"/></label><select aria-label={`${item.name} 배송처`} value={item.supplierId ?? ''} onChange={e=>setItems(prev=>prev.map(i=>i.productId===item.productId?{...i,supplierId:e.target.value||null,supplierName:suppliers.find(s=>s.id===e.target.value)?.name}:i))} className="w-full border rounded p-1"><option value="">기본 배송처</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></div><input type="number" aria-label={`${item.name} 수량`} min={1} max={999} value={item.quantity} onChange={e=>setItems(prev=>prev.map(i=>i.productId===item.productId?{...i,quantity:Number(e.target.value)}:i))} className="w-16 border rounded px-1 py-2"/><button onClick={()=>setItems(prev=>prev.filter(i=>i.productId!==item.productId))} className="text-red-500">삭제</button></div>)}</div></div>
        <div className="flex gap-2"><input aria-label="추가 상품 검색" placeholder="추가할 상품명" value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void findProducts()}}} className="flex-1 min-w-0 border rounded-lg p-2 text-sm"/><button disabled={loading} onClick={()=>void findProducts()} className="border rounded-lg px-3 text-sm">검색</button></div>
        <div className="max-h-56 overflow-y-auto space-y-2">{results.map(p=><button key={p.id} disabled={items.some(i=>i.productId===p.id)} onClick={()=>setItems(prev=>[...prev,{productId:p.id,name:p.name,price:p.livePrice,quantity:1,supplierId:p.supplierId}])} className="block w-full text-left border rounded-lg p-2 text-sm disabled:opacity-40">{p.name}{p.isVisible === false ? ' [숨김]' : ''} · {p.livePrice.toLocaleString()}원 {items.some(i=>i.productId===p.id)?'선택됨':'+ 추가'}</button>)}{hasMore&&<button disabled={loading} onClick={()=>void findProducts(true)} className="w-full text-sm border rounded p-2">검색 결과 더 보기</button>}{loading&&<p className="text-sm text-gray-400">검색 중…</p>}</div>
        {quote && <ShippingBreakdown groups={quote.groups} />}
        <label className="block text-sm">주문 총액 직접 수정 (선택)<input type="number" min={0} step={1} aria-label="주문 총액" value={manualTotal} placeholder={String(total)} onChange={e=>setManualTotal(e.target.value)} className="mt-1 w-full border rounded p-2" /></label>
        <p className="text-right font-bold">합계 {total.toLocaleString()}원</p>
        <p className="text-xs text-gray-500">상품·단가·배송처 변경 시 배송비를 다시 계산합니다. 총액 직접 수정 시 차액은 배송비 조정으로 기록됩니다. 실제 결제 승인·환불은 결제사에서 별도로 처리하며 결제 식별자는 보존됩니다.</p>
      </fieldset>
      {error&&<p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
      <div className="flex gap-2 mt-6"><button disabled={busy} onClick={onClose} className="flex-1 border rounded-lg py-3 font-bold">취소</button><button disabled={busy||!supplierReady||!quote||!address.trim()||!items.length||items.some(i=>!Number.isInteger(i.quantity)||i.quantity<1||i.quantity>999)} onClick={()=>void save()} className="flex-1 rounded-lg bg-orange-500 text-white py-3 font-bold disabled:opacity-40">{busy?'저장 중…':'수정 저장'}</button></div>
    </section>
  </div>
}
