'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Product } from '@/lib/types'
import type { Selection, Quote } from '@/lib/commerce/types'
import { selectionLabel, selectionTotal, validateProductSelection, selectedCartItems, cartSelections } from '@/lib/commerce/product-selection'
import { addToCart, appendCartItems, getCart } from '@/lib/cart-store'

function Counter({ label, quantity, max, onChange }: { label: string; quantity: number; max: number; onChange: (quantity: number) => void }) {
  return <div className="inline-flex items-center gap-3 rounded-lg border border-gray-200 bg-white">
    <button type="button" aria-label={`${label} 수량 감소`} disabled={quantity <= 1} onClick={() => onChange(quantity - 1)} className="h-10 w-10 font-bold disabled:opacity-30">−</button>
    <span aria-label={`${label} 수량`} className="min-w-5 text-center text-sm font-bold">{quantity}</span>
    <button type="button" aria-label={`${label} 수량 증가`} disabled={quantity >= Math.min(max, 9999)} onClick={() => onChange(quantity + 1)} className="h-10 w-10 font-bold disabled:opacity-30">+</button>
  </div>
}
export default function ProductPurchasePanel({ product, onAdded }: { product: Product; onAdded: (orderNow?: boolean) => void }) {
  const router = useRouter()
  const commerce = Array.isArray(product.options) && product.supplierId !== undefined
  const required = product.requiresOptions || (product.options?.length ?? 0) > 0
  const options = (product.options ?? []).filter(o => o.is_active)
  const addons = (product.addons ?? []).filter(a => a.is_active)
  const [lines, setLines] = useState<Selection[]>(() => commerce && !required ? [{ lineId: crypto.randomUUID(), productId: product.id, optionId: null, quantity: 1, addons: [] }] : [])
  const [addonParent, setAddonParent] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const parent = lines.find(l => l.lineId === addonParent) ?? lines[0]
  const available = commerce ? !!product.supplierId && !!product.supplier?.is_active && (required ? options.some(o => o.stock > 0) : product.quantity > 0) : product.quantity > 0
  function update(next: Selection[]) {
    try { if (next.length) validateProductSelection(product, next); setLines(next); setError(''); setNotice('') }
    catch (err) { setError(err instanceof Error ? err.message : '선택 내용을 확인해 주세요.') }
  }
  function selectOption(id: string) {
    if (!id) return
    const existing = lines.find(l => l.optionId === id)
    update(existing ? lines.map(l => l === existing ? { ...l, quantity: l.quantity + 1 } : l) : [...lines, { lineId: crypto.randomUUID(), productId: product.id, optionId: id, quantity: 1, addons: [] }])
  }
  function setAddon(id: string, quantity: number) {
    if (!parent) { setError('필수 옵션을 먼저 선택해 주세요.'); return }
    update(lines.map(l => l.lineId !== parent.lineId ? l : { ...l, addons: [...(l.addons ?? []).filter(a => a.addonId !== id), ...(quantity > 0 ? [{ addonId: id, quantity }] : [])] }))
  }
  async function add(orderNow: boolean) {
    setError(''); setNotice('')
    try {
      if (!available) throw new Error('현재 구매할 수 없는 상품입니다.')
      if (!commerce) {
        if (!orderNow || !getCart().some(item => !item.commerceVersion && item.productId === product.id)) {
          addToCart({ productId: product.id, productName: product.name, price: product.livePrice, imageUrl: product.imageUrl })
        }
        onAdded(orderNow); setNotice('장바구니에 담았습니다.')
        if (orderNow) router.push('/cart')
        return
      }
      setBusy(true)
      const cart = getCart()
      validateProductSelection(product, lines, cart)
      const selected = lines.map(l => ({ ...l, lineId: crypto.randomUUID() }))
      const response = await fetch('/api/cart/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [...cartSelections(cart.filter(i => i.productId === product.id)), ...selected] }) })
      const result = await response.json() as Quote & { error?: string }
      if (!response.ok) throw new Error(result.error ?? '가격과 재고를 확인하지 못했습니다.')
      appendCartItems(selectedCartItems(product, selected, result))
      onAdded(); setNotice('선택한 옵션과 추가 구성상품을 장바구니에 담았습니다.')
      if (orderNow) router.push('/cart')
    } catch (err) { setError(err instanceof Error ? err.message : '장바구니에 담지 못했습니다.') }
    finally { setBusy(false) }
  }
  return (
    <section aria-label="상품 구매 선택" className="border-t border-gray-100 bg-white">
      {commerce && <fieldset disabled={busy} className="space-y-5 px-5 py-5">
        <legend className="sr-only">상품 옵션과 추가 구성상품 선택</legend>
        <div className="rounded-xl bg-green-50 p-3 text-xs leading-relaxed text-green-800">
          {product.supplier ? `${product.supplier.name} 출고 · 같은 출고지 ${product.supplier.free_shipping_threshold.toLocaleString()}원 이상 무료배송 (미만 ${product.supplier.shipping_fee.toLocaleString()}원)` : '현재 출고지 확인 중인 상품입니다.'}
        </div>
        {required && <div>
          <label htmlFor="required-option" className="mb-2 block text-sm font-bold text-gray-900">필수 옵션 선택</label>
          <select id="required-option" value="" disabled={!available} onChange={e => selectOption(e.target.value)} className="w-full rounded-xl border border-gray-300 bg-white p-3 text-sm disabled:bg-gray-100">
            <option value="">옵션을 선택해 주세요 (여러 개 선택 가능)</option>
            {options.map(o => <option key={o.id} value={o.id} disabled={o.stock <= 0}>{o.option_name}: {o.option_value} · {(product.livePrice + o.additional_price).toLocaleString()}원{o.stock <= 0 ? ' (품절)' : ` (재고 ${o.stock}개)`}</option>)}
          </select>
          <p className="mt-1 text-xs text-gray-500">다시 선택한 옵션은 아래 목록에서 수량이 늘어납니다.</p>
        </div>}
        <div className="space-y-2">
          <h3 className="text-sm font-bold text-gray-900">선택된 옵션 목록</h3>
          {!lines.length && <p className="rounded-xl bg-gray-50 p-4 text-sm text-gray-500">필수 옵션을 선택하면 여기에 추가됩니다.</p>}
          {lines.map(line => {
            const label = selectionLabel(product, line)
            const option = options.find(o => o.id === line.optionId)
            return <div key={line.lineId} className="space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
              <div className="flex items-center justify-between gap-2"><p className="text-sm font-bold text-gray-800">{label}</p><button type="button" aria-label={`${label} 삭제`} onClick={() => update(lines.filter(l => l.lineId !== line.lineId))} className="h-8 w-8 rounded-full text-gray-500 hover:bg-white">✕</button></div>
              <div className="flex flex-wrap items-center justify-between gap-2"><Counter label={label} quantity={line.quantity} max={option?.stock ?? product.quantity} onChange={quantity => update(lines.map(l => l.lineId === line.lineId ? { ...l, quantity } : l))} /><span className="text-sm font-bold">{((product.livePrice + (option?.additional_price ?? 0)) * line.quantity).toLocaleString()}원</span></div>
              {(line.addons ?? []).map(selected => <p key={selected.addonId} className="text-xs text-gray-600">+ {addons.find(a => a.id === selected.addonId)?.addon_name} {selected.quantity}개 · {((addons.find(a => a.id === selected.addonId)?.price ?? 0) * selected.quantity).toLocaleString()}원</p>)}
            </div>
          })}
          {!required && !lines.length && <button type="button" onClick={() => update([{ lineId: crypto.randomUUID(), productId: product.id, quantity: 1, addons: [] }])} className="rounded-xl border border-orange-300 p-3 text-sm font-bold text-orange-600">기본 상품 추가</button>}
        </div>
        {addons.length > 0 && <div className="space-y-3 border-t border-gray-100 pt-4">
          <h3 className="text-sm font-bold text-gray-900">추가 구성상품 선택 <span className="font-normal text-gray-500">(선택)</span></h3>
          {lines.length > 1 && <label className="block text-xs text-gray-600">함께 구매할 옵션<select aria-label="추가 구성상품을 연결할 옵션" value={parent?.lineId ?? ''} onChange={e => setAddonParent(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 bg-white p-2 text-sm">{lines.map(l => <option key={l.lineId} value={l.lineId}>{selectionLabel(product, l)}</option>)}</select></label>}
          {!parent && <p className="text-xs text-gray-500">필수 옵션을 먼저 선택해 주세요.</p>}
          {addons.map(addon => {
            const selected = parent?.addons?.find(a => a.addonId === addon.id)
            return <div key={addon.id} className="space-y-2 rounded-xl border border-gray-200 p-3">
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={!!selected} disabled={!parent || addon.stock <= 0 || !available} onChange={e => setAddon(addon.id, e.target.checked ? 1 : 0)} className="mt-1 h-4 w-4 accent-orange-500" /><span className="flex-1 font-semibold">{addon.addon_name}<span className="mt-1 block text-xs font-normal text-gray-500">{addon.price.toLocaleString()}원 · {addon.stock > 0 ? `재고 ${addon.stock}개` : '품절'}</span></span></label>
              {selected && <Counter label={addon.addon_name} quantity={selected.quantity} max={addon.stock} onChange={quantity => setAddon(addon.id, quantity)} />}
            </div>
          })}
          <p className="text-xs text-gray-500">추가상품 수량은 독립적으로 선택하며, 대표 상품과 같은 출고지 금액에 합산됩니다.</p>
        </div>}
        <div className="flex justify-between border-t border-gray-200 pt-4 text-sm font-bold"><span>선택 상품 합계</span><span className="text-lg text-orange-600">{selectionTotal(product, lines).toLocaleString()}원</span></div>
      </fieldset>}
      <div aria-live="polite" className="px-5">{error && <p role="alert" className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}{notice && <p className="mb-3 rounded-xl bg-green-50 p-3 text-sm text-green-800">{notice} <a href="/cart" className="font-bold underline">장바구니 보기</a></p>}{!available && <p className="mb-3 text-sm font-bold text-gray-500">{commerce && !product.supplier?.is_active ? '출고지 확인 후 구매할 수 있습니다.' : '현재 품절된 상품입니다.'}</p>}</div>
      <div className="flex gap-2 border-t border-gray-100 bg-white px-5 py-4 pb-[calc(1rem_+_env(safe-area-inset-bottom))]">
        <button type="button" onClick={() => router.back()} className="rounded-xl bg-gray-100 px-4 py-3 text-sm font-bold text-gray-600">뒤로</button>
        <button type="button" disabled={busy || !available || (commerce && !lines.length)} onClick={() => add(false)} className="flex-1 rounded-xl border-2 border-orange-300 bg-white py-3 text-sm font-bold text-orange-600 disabled:opacity-40">{busy ? '확인 중...' : '장바구니 담기'}</button>
        <button type="button" disabled={busy || !available || (commerce && !lines.length)} onClick={() => add(true)} className="flex-1 rounded-xl bg-orange-600 py-3 text-sm font-bold text-white disabled:opacity-40">{commerce ? '담고 주문하기' : '바로 주문'}</button>
      </div>
    </section>
  )
}
