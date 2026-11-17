'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Product } from '@/lib/types'
import type { PurchaseConfig } from '@/lib/purchase-config'
import { getCart, replaceCart } from '@/lib/cart-store'
import PurchaseConfirmDialog from './PurchaseConfirmDialog'
export default function ConfiguredPurchase({ product, onAdded, showActions = true }: { product: Product; onAdded: () => void; showActions?: boolean }) {
  const saving = useRef(false)
  const [pendingAction, setPendingAction] = useState<boolean | null>(null)
  const router = useRouter()
  const addRef = useRef<(now: boolean) => void>(() => {})
  useEffect(() => { const listener = (event: Event) => { addRef.current((event as CustomEvent<boolean>).detail) }; window.addEventListener('purchase-action', listener); return () => window.removeEventListener('purchase-action', listener) }, [])
  const [config, setConfig] = useState<PurchaseConfig>({ variants: [], addons: [] }), [products, setProducts] = useState<Product[]>([])
  const [quantities, setQuantities] = useState<Record<string, number>>({}), [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('')
  useEffect(() => { let active = true
    fetch(`/api/products/${product.id}/configuration`, { cache: 'no-store' }).then(async r => { const d = await r.json(); if (!r.ok) throw Error(d.error); if (active) { setConfig(d.config); setProducts(d.products); if (!d.config.variants.length) { setSelected([product.id]); setQuantities({ [product.id]: 1 }) } } }).catch(e => { if (active) setError(e.message) }).finally(() => { if (active) setBusy(false) }); return () => { active = false }
  }, [product.id])
  function choose(id: string, checked: boolean) { setSelected(old => checked ? [...old, id] : old.filter(v => v !== id)); setQuantities(old => ({ ...old, [id]: old[id] || 1 })); setNotice('') }
  async function add(now: boolean) {
    if (busy || saving.current) return
    saving.current = true
    setError(''); setNotice('')
    try {
      const mains = config.variants.length ? config.variants.map(c => c.productId) : [product.id]
      if (!selected.some(id => mains.includes(id))) throw Error('메인 상품의 색상 또는 옵션을 선택해주세요.')
      setBusy(true)
      const existing = getCart(); if (existing.some(c => c.commerceVersion)) throw Error('기존 장바구니의 주문 방식을 먼저 확인해주세요.')
      const requestItems = [...existing.map(c => ({ productId: c.productId, quantity: c.quantity })), ...selected.map(id => ({ productId: id, quantity: quantities[id] }))]
      const r = await fetch('/api/cart/shipping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: requestItems }) }), data = await r.json()
      if (!r.ok) throw Error(data.error)
      replaceCart(data.cart); onAdded(); setNotice('선택한 상품을 장바구니에 담았습니다.'); if (now) router.push('/cart?checkout=1')
    } catch (e) { setError(e instanceof Error ? e.message : '상품 선택을 확인해주세요.') } finally { saving.current = false; setBusy(false) }
  }
  function requestAdd(now: boolean) {
    if (busy || saving.current) return
    setPendingAction(now)
  }
  addRef.current = requestAdd
  const total = selected.reduce((sum,id) => sum + (products.find(p => p.id === id)?.livePrice ?? 0) * (quantities[id] || 0), 0)
  return <section id="purchase-selection" className="scroll-mt-20 border-y border-orange-100 bg-white p-5 space-y-4" aria-label="상품 옵션 및 수량 선택">
    <fieldset disabled={busy} className="space-y-4"><legend className="font-bold mb-3">{config.title || '상품 선택 · 수량'}</legend>
      {(['variants','addons'] as const).map(kind => { const choices = kind === 'variants' && !config.variants.length ? [{ productId: product.id, label: '기본 상품' }] : config[kind]; return choices.length > 0 && <div key={kind} className="space-y-2"><h3 className="text-sm font-bold">{kind === 'variants' ? '메인 상품 / 색상 선택' : '추가 구성상품 (선택)'}</h3>{choices.map(choice => { const p = products.find(p => p.id === choice.productId), checked = selected.includes(choice.productId); return <div key={choice.productId} className="rounded-xl border p-3 space-y-2"><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={checked} disabled={!p || !p.isVisible || p.quantity <= 0} onChange={e => choose(choice.productId, e.target.checked)} className="mt-1"/><span className="flex-1">{choice.label}<span className="block text-xs text-gray-500">{p ? `${p.livePrice.toLocaleString()}원 · ${p.quantity > 0 ? '재고 ' + p.quantity + '개' : '품절'}` : '상품 확인 중'}</span></span></label>{checked && <label className="flex justify-between items-center text-sm">수량<input aria-label={`${choice.label} 수량`} type="number" min={1} max={Math.min(p?.quantity ?? 0,999)} step={1} value={quantities[choice.productId] || ''} onChange={e => setQuantities({ ...quantities, [choice.productId]: Number(e.target.value) })} className="w-24 rounded-lg border p-2" /></label>}</div>})}</div> })}
      <p className="text-xs text-gray-500">메인 상품과 추가상품 수량을 각각 선택할 수 있습니다. 추가상품도 해당 거래처의 배송비·무료배송 합계에 포함됩니다.</p>
      <p className="text-right font-bold">상품 합계 {total.toLocaleString()}원</p>
      {showActions && <div className="flex gap-2"><button type="button" onClick={() => requestAdd(false)} className="flex-1 rounded-xl border border-orange-400 py-3 font-bold text-orange-600">장바구니에 담기</button><button type="button" onClick={() => requestAdd(true)} className="flex-1 rounded-xl bg-orange-500 py-3 font-bold text-white">바로 주문</button></div>}
    </fieldset>{error && <p role="alert" className="text-sm text-red-600">{error}</p>}{notice && <p role="status" className="text-sm text-green-700">{notice}</p>}
    {pendingAction !== null && <PurchaseConfirmDialog orderNow={pendingAction} onCancel={() => setPendingAction(null)} onConfirm={() => {
      const now = pendingAction
      setPendingAction(null)
      document.getElementById('purchase-selection')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      void add(now)
    }} />}
  </section>
}
