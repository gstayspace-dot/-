import ProductSupplierLabel from '@/app/components/ProductSupplierLabel'
import type { Quote } from '@/lib/commerce/types'
import type { OrderResult } from '@/lib/commerce/checkout'

export function PriceSummary({ quote }: { quote: Quote }) {
  return <section aria-label="결제 금액 요약" className="space-y-3 rounded-2xl bg-gray-50 p-4">
    <div className="flex justify-between gap-3 text-sm"><span>상품 합계</span><strong>{quote.subtotal.toLocaleString()}원</strong></div>
    <div className="flex justify-between gap-3 text-sm"><span>총 배송비</span><strong>{quote.shippingTotal.toLocaleString()}원</strong></div>
    <ul aria-label="출고지별 배송비" className="space-y-1 rounded-xl bg-white p-3 text-xs text-gray-600">{quote.shippingGroups.map(g => <li key={g.supplierId} className="flex justify-between gap-3"><span>{g.supplierName}</span><span className={g.shippingFee ? '' : 'font-bold text-green-700'}>{g.shippingFee ? `${g.shippingFee.toLocaleString()}원` : '무료'}</span></li>)}</ul>
    <div className="flex justify-between gap-3 border-t border-gray-200 pt-3 font-bold"><span>총 결제금액</span><span className="text-xl text-orange-600">{quote.total.toLocaleString()}원</span></div>
  </section>
}
export function OrderLines({ quote }: { quote: Quote }) {
  return <ul aria-label="주문 상품" className="space-y-2">{quote.items.filter(i => i.kind === 'product').map(i => <li key={i.lineId} className="space-y-1 rounded-xl border border-gray-200 p-3 text-sm">
    <p className="font-bold">{i.productName}</p>{i.optionLabel && <p className="text-xs font-semibold text-orange-700">{i.optionLabel}</p>}
    <ProductSupplierLabel name={i.supplierName} historical /><p className="text-xs text-gray-500">{i.quantity}개 · {(i.price * i.quantity).toLocaleString()}원</p>
    {quote.items.filter(a => a.parentLineId === i.lineId).map(a => <p key={a.lineId} className="text-xs text-gray-600">+ {a.productName} {a.quantity}개 · {(a.price * a.quantity).toLocaleString()}원</p>)}
  </li>)}</ul>
}
export function OrderReceipt({ result }: { result: OrderResult }) {
  const paymentLabels: Record<string, string> = { pending: '결제 대기', confirming: '결제 확인 중', payment_review: '결제 결과 확인 중', paid: '결제 완료', additional_payment_required: '추가 결제 필요', refund_required: '환불 정산 필요', cancelled: '취소 완료' }
  return <div className="space-y-4"><div className="rounded-xl bg-orange-50 p-4 text-sm"><p className="break-words font-bold">주문번호 {result.order.id}</p><p className="mt-1">주문 상태: {result.order.status}</p><p className="mt-1">결제 상태: {paymentLabels[result.order.payment_status] ?? result.order.payment_status}</p><p className="mt-2">{result.order.recipient_name} · {result.order.recipient_phone}</p><p className="mt-1 break-words">{result.order.recipient_address}</p>{result.order.customer_request && <p className="mt-1 text-xs text-gray-600">배송 요청: {result.order.customer_request}</p>}</div><OrderLines quote={result.quote} /><PriceSummary quote={result.quote} /></div>
}
