import { supabase, readProductMetaRegistry, BRAND_REGISTRY_PRODUCT_ID, CATEGORY_REGISTRY_PRODUCT_ID, PRODUCT_META_REGISTRY_PRODUCT_ID, splitSpecsAndDescription } from './supabaseClient'
import { receiptDb } from './receipt-db'
import { buildShippingQuote, type ShippingSupplier, type ShippingGroup } from './shipping-quote'

export class ShippingError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}
export type ShippingOrderItem = {
  product_id: string; product_name: string; price: number; quantity: number
  supplier_id: string | null; supplier_name: string
}
export type ShippingRecommendation = { id: string; name: string; price: number; imageUrl: string; stock: number }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RESERVED = [BRAND_REGISTRY_PRODUCT_ID, CATEGORY_REGISTRY_PRODUCT_ID, PRODUCT_META_REGISTRY_PRODUCT_ID]

export async function loadShippingSuppliers(ids?: string[]): Promise<ShippingSupplier[]> {
  if (ids?.length === 0) return []
  const db = receiptDb()
  if (!db) throw new ShippingError('배송처 설정을 불러올 수 없습니다.', 503)
  let query = db.from('suppliers').select('id,name,free_shipping_threshold,shipping_fee').order('name')
  if (ids) query = query.in('id', ids)
  const { data, error } = await query
  if (error) throw new ShippingError('배송처 조회에 실패했습니다.', 503)
  if (ids && data?.length !== new Set(ids).size) throw new ShippingError('상품의 배송처 설정을 확인해주세요.', 503)
  return data as ShippingSupplier[]
}

/** Prices and suppliers come only from DB, never from browser cart fields. */
export async function quoteShippingCart(input: unknown) {
  if (!Array.isArray(input) || !input.length || input.length > 100) throw new ShippingError('주문 상품을 확인해주세요.')
  const quantities = new Map<string, number>()
  for (const item of input) {
    if (!item || typeof item.productId !== 'string' || !UUID.test(item.productId) || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 999) throw new ShippingError('상품 수량을 확인해주세요.')
    const id = item.productId.toLowerCase(), quantity = (quantities.get(id) ?? 0) + item.quantity
    if (quantity > 999) throw new ShippingError('상품별 최대 수량은 999개입니다.')
    quantities.set(id, quantity)
  }
  const { data: products, error } = await supabase.from('products').select('id,name,live_price,quantity,specs,supplier_id').in('id', Array.from(quantities.keys()))
  if (error) throw new ShippingError('상품 조회에 실패했습니다.', 503)
  const registry = await readProductMetaRegistry()
  for (const [id, quantity] of Array.from(quantities.entries())) {
    const product = products?.find(product => product.id === id)
    if (!product || RESERVED.includes(id) || !splitSpecsAndDescription(product.specs ?? '').isVisible || registry[id]?.isVisible === false) throw new ShippingError('판매 상품이 변경되었습니다. 다시 확인해주세요.')
    if (registry[id]?.isSoldOut === true || product.quantity <= 0) throw new ShippingError(`${product.name} · 품절된 상품입니다. 장바구니에서 삭제하거나 다른 상품을 선택해주세요.`, 409)
    if (!Number.isSafeInteger(product.live_price) || product.live_price < 0 || !Number.isSafeInteger(product.quantity) || quantity > product.quantity) throw new ShippingError('상품 가격 또는 재고를 확인해주세요.')
  }
  const suppliers = await loadShippingSuppliers(Array.from(new Set((products ?? []).map(product => product.supplier_id).filter((id): id is string => Boolean(id)))))
  const quote = buildShippingQuote(Array.from(quantities, ([productId, quantity]) => {
    const product = products!.find(product => product.id === productId)!
    return { productId, supplierId: product.supplier_id ?? null, price: product.live_price, quantity }
  }), suppliers)
  const items: ShippingOrderItem[] = Array.from(quantities, ([product_id, quantity]) => {
    const product = products!.find(product => product.id === product_id)!
    const group = quote.groups.find(group => group.productIds.includes(product_id))!
    return { product_id, product_name: product.name, price: product.live_price, quantity, supplier_id: group.supplierId, supplier_name: group.supplierName }
  })
  const cart = items.map(item => ({ productId: item.product_id, productName: item.product_name, price: item.price, quantity: item.quantity, imageUrl: `/api/products/${item.product_id}/image`, supplierId: item.supplier_id, supplierName: item.supplier_name, stock: products!.find(product => product.id === item.product_id)!.quantity }))
  return { items, cart, ...quote }
}

export async function shippingRecommendations(groups: ShippingGroup[]): Promise<Record<string, ShippingRecommendation[]>> {
  const registry = await readProductMetaRegistry()
  const inCart = new Set(groups.flatMap(group => group.productIds))
  const results = await Promise.all(groups.filter(group => group.supplierId && group.shippingFee > 0 && group.remainingForFreeShipping > 0).map(async group => {
    const { data, error } = await supabase.from('products').select('id,name,live_price,quantity,supplier_id')
      .eq('supplier_id', group.supplierId!).gt('quantity', 0).gt('live_price', 0)
      .order('live_price', { ascending: true }).order('id').limit(500)
    if (error) return [group.supplierId!, []] as const
    const candidates = (data ?? []).filter(product => !inCart.has(product.id) && !RESERVED.includes(product.id) && registry[product.id]?.isVisible !== false && registry[product.id]?.isSoldOut !== true)
    candidates.sort((a, b) => Number(b.live_price >= group.remainingForFreeShipping) - Number(a.live_price >= group.remainingForFreeShipping) || Math.abs(a.live_price - group.remainingForFreeShipping) - Math.abs(b.live_price - group.remainingForFreeShipping) || a.id.localeCompare(b.id))
    return [group.supplierId!, candidates.slice(0, 4).map(product => ({ id: product.id, name: product.name, price: product.live_price, stock: product.quantity, imageUrl: `/api/products/${product.id}/image` }))] as const
  }))
  return Object.fromEntries(results)
}
