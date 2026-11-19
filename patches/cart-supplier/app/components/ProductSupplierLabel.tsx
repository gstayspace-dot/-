import { DEFAULT_SHIPPING_NAME } from '@/lib/shipping-quote'

export default function ProductSupplierLabel({ name, loading = false, historical = false }: {
  name?: string | null; loading?: boolean; historical?: boolean
}) {
  const supplier = typeof name === 'string' ? name.trim() : ''
  const text = loading ? '수입원 확인 중…'
    : supplier && supplier !== DEFAULT_SHIPPING_NAME ? `수입원: ${supplier}`
    : historical && !supplier ? '수입원 정보 없음'
    : '수입원: 미지정 (기본배송)'
  return <p className="mt-1 w-fit max-w-full break-words rounded-lg border border-blue-100 bg-blue-50 px-2 py-1 text-xs font-bold leading-relaxed text-blue-800" data-product-supplier="true">{text}</p>
}
