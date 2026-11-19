'use client'
import type { ShippingGroup } from '@/lib/shipping-quote'
import type { ShippingRecommendation } from '@/lib/shipping-server'

export default function ShippingBreakdown({ groups, recommendations = {}, onAdd }: {
  groups: ShippingGroup[]; recommendations?: Record<string, ShippingRecommendation[]>; onAdd?: (product: ShippingRecommendation) => void
}) {
  if (!groups.length) return null
  return <section aria-label="배송처별 배송비" className="rounded-2xl border border-blue-100 bg-blue-50/40 p-4 space-y-3">
    <h3 className="text-sm font-extrabold text-gray-800">배송처별 배송비 안내</h3>
    <p className="text-xs text-gray-600">같은 배송처 상품끼리 합산하며, 배송처별 50,000원 이상 구매 시 무료입니다.</p>
    {groups.map(group => <div key={group.supplierId ?? 'default'} className="rounded-xl border border-gray-200 bg-white p-3" aria-label={`${group.supplierName} 배송비`}>
      <div className="flex justify-between gap-2 text-sm font-bold"><span className="break-words">{group.supplierName}</span><span className={group.shippingFee ? 'text-gray-800 whitespace-nowrap' : 'text-green-600 whitespace-nowrap'}>{`배송비 : ${group.shippingFee ? `${group.shippingFee.toLocaleString()}원` : '무료'}`}</span></div>
      <p className="mt-1 text-xs text-gray-500">상품 합계 {group.subtotal.toLocaleString()}원</p>
      {group.shippingFee > 0 && group.remainingForFreeShipping > 0 && <p className="mt-2 text-xs font-bold text-orange-600">이 배송처에서 {group.remainingForFreeShipping.toLocaleString()}원 더 담으면 무료배송</p>}
      {onAdd && group.supplierId && !!recommendations[group.supplierId]?.length && <div className="mt-3 border-t pt-3">
        <p className="text-xs font-bold text-gray-700 mb-2">같은 배송처 추천상품</p>
        <div className="space-y-2">{recommendations[group.supplierId].map(product => <div key={product.id} className="flex gap-2 items-center text-xs">
          <a href={`/product/${product.id}`} className="flex-1 min-w-0"><span className="block break-words text-gray-700">{product.name}</span><span className="block mt-1 font-bold text-red-500">{product.price.toLocaleString()}원</span></a>
          <button type="button" aria-label={`${product.name} 추가 담기`} onClick={() => onAdd(product)} className="shrink-0 border border-orange-200 rounded-lg px-2 py-2 text-orange-600 font-bold">+ 담기</button>
        </div>)}</div>
      </div>}
    </div>)}
    <div className="flex justify-between border-t border-blue-100 pt-3 text-sm font-bold"><span>총 배송비 :</span><span>{groups.reduce((sum, group) => sum + group.shippingFee, 0).toLocaleString()}원</span></div>
  </section>
}
