'use client'
import { useEffect, useState } from 'react'
import { productIsSoldOut } from '@/lib/product-availability'
import type { Product } from '@/lib/types'
import { purchaseOptionLabel, purchaseSelectionTitle, withPurchaseOptionLabel, type PurchaseConfig } from '@/lib/purchase-config'
export default function PurchaseConfigEditor({ productId }: { productId: string }) {
  const [availabilityBusy, setAvailabilityBusy] = useState<string | null>(null)
  const [config, setConfig] = useState<PurchaseConfig>({ variants: [], addons: [] })
  const [version, setVersion] = useState<string | null>(null), [products, setProducts] = useState<Product[]>([])
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('')
  useEffect(() => { let active = true; setBusy(true); setError(''); setNotice('')
    Promise.all([fetch(`/api/products/${productId}/configuration`, { cache: 'no-store' }), fetch('/api/products?includeHidden=true', { cache: 'no-store' })]).then(async ([a,b]) => {
      const detail = await a.json(), all = await b.json(); if (!a.ok || !b.ok) throw Error(detail.error || '상품 조회 실패')
      if (active) { setConfig(detail.config); setVersion(detail.version); setProducts(all) }
    }).catch(e => { if (active) setError(e.message) }).finally(() => { if (active) setBusy(false) }); return () => { active = false }
  }, [productId])
  async function changeAvailability(id: string, isSoldOut: boolean) {
    const product = products.find(p => p.id === id)
    if (!product || availabilityBusy || busy) return
    setAvailabilityBusy(id); setError(''); setNotice('')
    try {
      const r = await fetch(`/api/products/${id}/availability`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isSoldOut, expected: product.isSoldOut === true }) }), data = await r.json()
      if (!r.ok) throw Error(data.error || '품절 설정을 저장하지 못했습니다.')
      setProducts(old => old.map(p => p.id === id ? { ...p, isSoldOut: data.isSoldOut } : p))
      setNotice(`${product.name} · ${isSoldOut ? '품절로 설정' : '품절 해제'}했습니다. 같은 상품이 연결된 모든 묶음에 적용됩니다.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '품절 설정 실패')
      const fresh = await fetch('/api/products?includeHidden=true', { cache: 'no-store' }).catch(() => null)
      if (fresh?.ok) setProducts(await fresh.json())
    } finally { setAvailabilityBusy(null) }
  }
  function availabilityControl(id: string, label: string) {
    const product = products.find(p => p.id === id)
    return <label className="inline-flex flex-col gap-1 text-xs"><span className="inline-flex items-center gap-1.5"><input type="checkbox" aria-label={label} checked={!!product && productIsSoldOut(product)} disabled={!product || product.quantity <= 0 || busy || !!availabilityBusy} onChange={e => void changeAvailability(id, e.target.checked)} />품절</span>{product && product.quantity <= 0 && <span className="text-gray-500">재고 0개 · 자동 품절</span>}{availabilityBusy === id && <span className="text-orange-600">저장 중…</span>}</label>
  }
  async function save() {
    setBusy(true); setError(''); setNotice('')
    try {
      const r = await fetch(`/api/products/${productId}/configuration`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config, version }) }), data = await r.json()
      if (!r.ok) throw Error(data.error)
      const fresh = await fetch(`/api/products/${productId}/configuration`, { cache: 'no-store' }); if (!fresh.ok) throw Error('저장 결과를 다시 불러와주세요.')
      setVersion((await fresh.json()).version); setNotice(config.variants.length || config.addons.length ? '구성을 저장했습니다. 연결된 상품은 대표 상품 안에서 판매됩니다.' : '묶음 구성을 해제했습니다. 다른 대표 상품에서 새롭게 연결할 수 있습니다.')
    } catch (e) { setError(e instanceof Error ? e.message : '저장 실패') } finally { setBusy(false) }
  }
  return <section className="my-5 space-y-3 rounded-xl border border-orange-200 p-3" aria-label="색상 및 추가구성 관리">
    <h3 className="font-bold">{purchaseOptionLabel(config)} 옵션 · 추가 구성상품</h3>
    <p className="text-xs text-gray-500">먼저 상품 등록에서 옵션·추가상품의 가격, 재고, 거래처를 등록한 뒤 아래 표에 연결하세요. 연결된 상품은 메인 목록에서 하나로 묶이며 기존 주문은 보존됩니다.</p>
    <p className="text-sm text-orange-700">같은 구성상품을 여러 대표 상품에 중복으로 연결할 수 있습니다.</p>
    <p className="text-xs text-gray-500">묶음을 해제하려면 모든 구성 행을 삭제한 뒤 [옵션 구성 저장]을 누르세요. 다른 묶음의 연결은 그대로 유지됩니다.</p>
    <p className="text-xs text-gray-500">품절 체크는 즉시 저장되며 같은 상품이 연결된 모든 묶음에 적용됩니다. 실제 재고 수량은 변경되지 않습니다.</p>
    <fieldset disabled={busy || !!availabilityBusy} className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border bg-gray-50 p-3"><span className="text-sm font-bold">현재 상품 판매 상태</span>{availabilityControl(productId, '현재 상품 품절')}</div>
      <label className="block text-sm font-bold">색상 대신 표시할 단어<input aria-label="색상 대신 표시할 단어" value={config.optionLabel ?? '색상'} maxLength={40} onChange={e => setConfig(withPurchaseOptionLabel(config, e.target.value))} className="mt-1 w-full rounded border p-2 font-normal" placeholder="예: 구성, 사이즈, 종류" /><span className="mt-1 block text-xs font-normal text-gray-500">위 옵션 관리 제목과 아래 필수 선택 옵션 제목에 함께 적용됩니다. 입력 후 [옵션 구성 저장]을 누르세요.</span></label>
      <label className="block text-sm">대표 상품 표시명<input aria-label="대표 상품 표시명" value={config.title ?? ''} maxLength={200} onChange={e => setConfig({ ...config, title: e.target.value })} className="mt-1 w-full rounded border p-2" placeholder="예: 보겐 멀티 스푼 받침 세트 (색상 선택)" /></label>
      <label className="block text-sm">상품 선택 영역 제목<input aria-label="상품 선택 영역 제목" value={config.variantsTitle ?? purchaseSelectionTitle(config)} maxLength={100} onChange={e => setConfig({ ...config, variantsTitle: e.target.value })} className="mt-1 w-full rounded border p-2" placeholder="예: 상품 구성 선택 / 색상과 사이즈 선택" /><span className="mt-1 block text-xs text-gray-500">고객 화면의 선택 영역 제목을 따로 지정할 수 있습니다. 비워두면 기본 문구를 사용합니다.</span></label>
      {(['variants', 'addons'] as const).map(kind => <div key={kind}>
      <div className="flex justify-between items-center"><h4 className="text-sm font-bold">{kind === 'variants' ? `${purchaseOptionLabel(config)} / 필수 선택 옵션` : '추가 구성상품 (선택 구매)'}</h4><button type="button" className="border rounded-lg p-2 text-xs" onClick={() => setConfig({ ...config, [kind]: [...config[kind], { productId: '', label: '' }] })}>+ 행 추가</button></div>
      <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr><th className="py-2 text-left">연결할 상품</th><th className="text-left">선택 표시명</th><th>품절 / 관리</th></tr></thead><tbody>{config[kind].map((choice, index) => <tr key={index}>
        <td className="py-1 pr-1"><select aria-label={`${kind} ${index + 1} 상품`} value={choice.productId} className="w-full max-w-64 border rounded p-2" onChange={e => { const product = products.find(p => p.id === e.target.value); setConfig({ ...config, [kind]: config[kind].map((c,i) => i === index ? { productId: e.target.value, label: product?.name ?? '' } : c) }) }}><option value="">상품 선택</option>{products.filter(p => kind !== 'addons' || p.id !== productId).map(p => <option key={p.id} value={p.id}>{p.name} · {p.livePrice.toLocaleString()}원 · {p.quantity}개</option>)}</select></td>
        <td><input aria-label={`${kind} ${index + 1} 표시명`} value={choice.label} maxLength={200} className="w-full min-w-20 border rounded p-2" onChange={e => setConfig({ ...config, [kind]: config[kind].map((c,i) => i === index ? { ...c, label: e.target.value } : c) })} /></td>
        <td className="min-w-16 text-center"><div className="flex flex-col items-center gap-1">{availabilityControl(choice.productId, `${kind} ${index + 1} 품절`)}<button type="button" className="whitespace-nowrap p-2 text-red-600" onClick={() => setConfig({ ...config, [kind]: config[kind].filter((_,i) => i !== index) })}>삭제</button></div></td>
      </tr>)}</tbody></table></div></div>)}
      <button type="button" className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-40" onClick={() => void save()}>옵션 구성 저장</button>
    </fieldset>{error && <p role="alert" className="text-sm text-red-600">{error}</p>}{notice && <p role="status" className="text-sm text-green-700">{notice}</p>}
  </section>
}
