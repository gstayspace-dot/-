import { quoteAdminShippingCart, loadShippingSuppliers } from '@/lib/shipping-server'
import { buildShippingQuote, DEFAULT_SHIPPING_NAME } from '@/lib/shipping-quote'
import { NextResponse, type NextRequest } from 'next/server'
import { receiptAdmin } from '@/lib/receipt-admin-auth'
import { supabase, fetchOrderItemsForOrders, type DbOrderItem } from '@/lib/supabaseClient'

export const dynamic = 'force-dynamic'
const LOCK = '\n[[ORDER_EDIT_LOCK:'
const invalid = (error: string, status = 400) => NextResponse.json({ error }, { status })
const signature = (items: DbOrderItem[]) => JSON.stringify(items.map(i => [i.id,i.product_id,i.product_name,i.quantity,i.price,i.supplier_id ?? null,i.supplier_name ?? null]).sort((a,b) => String(a[0]).localeCompare(String(b[0]))))

export async function PATCH(request: NextRequest) {
  if (!(await receiptAdmin(request))) return invalid('관리자로 다시 로그인해주세요.', 401)
  let body
  try { body = await request.json() } catch { return invalid('잘못된 요청입니다.') }
  if (!body || typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id) || !body.expected || typeof body.address !== 'string' || !body.address.trim() || body.address.length > 500 || !Array.isArray(body.items) || !body.items.length || body.items.length > 100) return invalid('주소와 주문 상품을 확인해주세요.')
  const { data: order, error } = await supabase.from('orders').select('*').eq('id',body.id).maybeSingle()
  if (error || !order || order.deleted_at) return invalid('수정할 주문을 찾지 못했습니다.',404)
  if ((order.customer_request || '').includes(LOCK)) return invalid('다른 수정 작업이 진행 중입니다. 잠시 후 다시 조회해주세요.',409)
  const original = await fetchOrderItemsForOrders([order.id])
  if (original.error) return invalid('주문 상품 조회에 실패했습니다.',503)
  const oldItems = original.data ?? []
  const expected = body.expected
  if (expected.customer_address !== order.customer_address || expected.total_price !== order.total_price || expected.status !== order.status || expected.customer_request !== order.customer_request || expected.payment_confirmed_at !== order.payment_confirmed_at || !Array.isArray(expected.items) || signature(expected.items) !== signature(oldItems)) return invalid('주문이 변경되었습니다. 목록을 새로고침한 후 다시 수정해주세요.',409)
  const fields = {
    customer_name: body.customerName ?? order.customer_name,
    customer_phone: body.customerPhone ?? order.customer_phone,
    customer_request: body.customerRequest ?? order.customer_request,
    created_at: body.createdAt ?? order.created_at,
    status: body.status ?? order.status,
    payment_method: body.paymentMethod ?? order.payment_method,
    payment_amount: body.paymentAmount === undefined ? order.payment_amount : body.paymentAmount,
    payment_confirmed_at: body.paymentConfirmedAt === undefined ? order.payment_confirmed_at : body.paymentConfirmedAt,
  }
  if (typeof fields.customer_name !== 'string' || !fields.customer_name.trim() || fields.customer_name.length > 100 || typeof fields.customer_phone !== 'string' || !/^0\d{8,10}$/.test(fields.customer_phone.replace(/\D/g,'')) || typeof fields.customer_request !== 'string' || fields.customer_request.length > 5000 || fields.customer_request.includes(LOCK) || typeof fields.created_at !== 'string' || !Number.isFinite(Date.parse(fields.created_at)) || typeof fields.status !== 'string' || ![order.status,'입금대기','결제대기','결제완료','배송중','배송완료','취소','결제취소','환불확인필요'].includes(fields.status) || (fields.payment_method != null && (typeof fields.payment_method !== 'string' || fields.payment_method.length > 100))) return invalid('주문자, 연락처, 일시, 상태를 확인해주세요.')
  if (order.payment_key && fields.payment_method !== order.payment_method) return invalid('실제 결제 거래의 결제 방식은 변경할 수 없습니다.',409)
  if (['customer_name','customer_phone','created_at','payment_method'].some(key => expected[key] !== order[key])) return invalid('주문이 변경되었습니다. 다시 조회해주세요.',409)
  if (fields.payment_amount != null && (!Number.isSafeInteger(fields.payment_amount) || fields.payment_amount < 0 || fields.payment_amount > 2147483647)) return invalid('입금액을 확인해주세요.')
  if (fields.payment_confirmed_at != null && (typeof fields.payment_confirmed_at !== 'string' || !Number.isFinite(Date.parse(fields.payment_confirmed_at)))) return invalid('입금 확인 일시를 확인해주세요.')
  if (order.payment_key && (fields.payment_amount !== order.payment_amount || fields.payment_confirmed_at !== order.payment_confirmed_at)) return invalid('결제사 승인 기록은 수동 변경할 수 없습니다.',409)
  const items: DbOrderItem[] = []
  const seen = new Set<string>()
  for (const item of body.items) {
    if (!item || typeof item.productId !== 'string' || seen.has(item.productId) || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 999) return invalid('상품별 수량은 1~999개로 입력해주세요.')
    seen.add(item.productId)
    const old = oldItems.find(i => i.product_id === item.productId)
    let name = old?.product_name, price = old?.price
    let supplierId = old?.supplier_id ?? null, supplierName = old?.supplier_name ?? DEFAULT_SHIPPING_NAME
    if (!old) {
      try {
        const quote = await quoteAdminShippingCart([item]), resolved = quote.items[0]
        name = resolved.product_name; price = resolved.price; supplierId = resolved.supplier_id; supplierName = resolved.supplier_name
      } catch (error) { return invalid(error instanceof Error ? error.message : '상품 조회 실패') }
    }
    if (item.price !== undefined) price = item.price
    if (item.name !== undefined) name = typeof item.name === 'string' ? item.name.trim() : ''
    if (item.supplierId !== undefined) {
      if (item.supplierId !== null && (typeof item.supplierId !== 'string' || !/^[0-9a-f-]{36}$/i.test(item.supplierId))) return invalid('배송처를 확인해주세요.')
      supplierId = item.supplierId
      if (supplierId) { const suppliers = await loadShippingSuppliers([supplierId]); supplierName = suppliers[0].name } else supplierName = DEFAULT_SHIPPING_NAME
    }
    if ((name?.length ?? 0) > 500) return invalid('상품명은 500자 이내로 입력해주세요.')
    if (typeof price !== 'number'  || !Number.isSafeInteger(price) || price < 0 || !name) return invalid('상품 가격을 확인해주세요.')
    items.push({id:crypto.randomUUID(),order_id:order.id,product_id:item.productId,product_name:name,quantity:item.quantity,price,supplier_id:supplierId,supplier_name:supplierName})
  }
  const changed = JSON.stringify(items.map(i=>[i.product_id,i.quantity,i.price,i.product_name,i.supplier_id ?? null]).sort()) !== JSON.stringify(oldItems.map(i=>[i.product_id,i.quantity,i.price,i.product_name,i.supplier_id ?? null]).sort())
  const subtotal = items.reduce((sum,item)=>sum+item.price*item.quantity,0)
  let shipping = order.shipping_breakdown ?? null
  let total = order.total_price
  if (changed) {
    try {
      const suppliers = await loadShippingSuppliers(Array.from(new Set(items.map(item => item.supplier_id).filter((id): id is string => !!id))))
      const quote = buildShippingQuote(items.map(item => ({ productId: item.product_id, supplierId: item.supplier_id ?? null, price: item.price, quantity: item.quantity })), suppliers.map(supplier => ({ ...supplier, name: items.find(item => item.supplier_id === supplier.id)?.supplier_name ?? supplier.name })))
      total = quote.total; shipping = quote.groups
    } catch { return invalid('배송비 계산에 실패했습니다. 다시 시도해주세요.',503) }
  }
  if (!Number.isSafeInteger(total) || total < 0) return invalid('주문 금액을 확인해주세요.')
  if (body.totalOverride !== undefined) {
    if (!Number.isSafeInteger(body.totalOverride) || body.totalOverride < subtotal || body.totalOverride > 2147483647) return invalid('총액은 상품 합계 이상의 원 단위 정수로 입력해주세요.')
    if (!shipping) {
      const suppliers = await loadShippingSuppliers(Array.from(new Set(items.map(i=>i.supplier_id).filter((id):id is string=>!!id))))
      shipping = buildShippingQuote(items.map(i=>({productId:i.product_id,supplierId:i.supplier_id??null,price:i.price,quantity:i.quantity})),suppliers).groups
    }
    let remainingFee = body.totalOverride - subtotal
    shipping = shipping.map((g: Record<string,unknown>,index:number) => { const fee = index === shipping.length - 1 ? remainingFee : Math.min(Number(g.shippingFee), remainingFee); remainingFee -= fee; return { ...g, shippingFee: fee } })
    total = body.totalOverride
  }
  const note = order.customer_request || ''
  const lock = `${note}${LOCK}${Date.now()}:${crypto.randomUUID()}]]`
  // A compare-and-set lease on the order serializes edits across Cloud Run instances.
  let claim = supabase.from('orders').update({customer_request:lock}).eq('id',order.id).eq('status',order.status).eq('total_price',order.total_price).eq('customer_address',order.customer_address)
  claim = order.customer_request === null ? claim.is('customer_request',null) : claim.eq('customer_request',order.customer_request)
  const claimed = await claim.select('id')
  if (claimed.error || !claimed.data?.length) return invalid('주문이 변경되었습니다. 다시 조회해주세요.',409)
  let staged = false, committed = false
  try {
    if (changed) {
      const inserted = await supabase.from('order_items').insert(items)
      if (inserted.error) throw new Error('상품 저장에 실패했습니다.')
      staged = true
    }
    let save = supabase.from('orders').update({...fields,customer_request:lock,customer_address:body.address.trim(),total_price:total,shipping_breakdown:shipping}).eq('id',order.id).eq('customer_request',lock).eq('status',order.status)
    save = order.payment_confirmed_at == null ? save.is('payment_confirmed_at',null) : save.eq('payment_confirmed_at',order.payment_confirmed_at)
    const saved = await save.select('id')
    if (saved.error || !saved.data?.length) throw new Error('결제 또는 주문 상태가 변경되었습니다. 다시 조회해주세요.')
    committed = true
    if (changed && oldItems.length) {
      const removed = await supabase.from('order_items').delete().eq('order_id',order.id).in('id',oldItems.map(i=>i.id))
      if (removed.error) throw new Error('기존 상품 교체에 실패했습니다.')
    }
    const unlocked = await supabase.from('orders').update({customer_request:fields.customer_request}).eq('id',order.id).eq('customer_request',lock).select('id')
    if (unlocked.error || !unlocked.data?.length) return invalid('수정 내용은 저장됐지만 주문 잠금 해제를 확인해야 합니다. 관리자에게 문의해주세요.',503)
    return NextResponse.json({ok:true,total})
  } catch (err) {
    // New rows are staged first; originals remain intact until the final removal.
    // Roll back both the staged rows and the header on any failed write.
    let rollbackFailed = false
    if (staged) {
      const removed = await supabase.from('order_items').delete().eq('order_id',order.id).in('id',items.map(i=>i.id))
      rollbackFailed = Boolean(removed.error)
    }
    const restored = await supabase.from('orders').update({customer_request:order.customer_request,...(committed ? {payment_amount:order.payment_amount,payment_confirmed_at:order.payment_confirmed_at,customer_name:order.customer_name,customer_phone:order.customer_phone,created_at:order.created_at,status:order.status,payment_method:order.payment_method,customer_address:order.customer_address,total_price:order.total_price,shipping_breakdown:order.shipping_breakdown ?? null} : {})}).eq('id',order.id).eq('customer_request',lock).select('id')
    rollbackFailed ||= Boolean(restored.error || !restored.data?.length)
    return invalid(rollbackFailed ? `주문 #${order.id.slice(0,8)}의 수정 복구 상태를 확인해주세요. 중복 저장하지 마세요.` : err instanceof Error ? err.message : '수정 저장에 실패했습니다.',503)
  }
}
