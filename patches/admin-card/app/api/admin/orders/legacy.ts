import { quoteAdminShippingCart, ShippingError } from '@/lib/shipping-server'
import { receiptAdmin } from '@/lib/receipt-admin-auth'
import { receiptSummaries } from '@/lib/cash-receipt'
import { NextResponse, type NextRequest } from 'next/server'
import { notifyOrder } from '@/lib/order-notification'
import { allowedPayappOrigin, payappConfig } from '@/lib/payapp'
import { requestPayappPayment } from '@/lib/payapp-request'
import {
  fetchOrderItemsForOrders,
  supabase,
  type DbOrder,
  type DbOrderItem,
} from '@/lib/supabaseClient'


export async function POST(request: NextRequest) {
  if (!(await receiptAdmin(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  let body
  try { body = await request.json() } catch {
    return NextResponse.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 })
  }
  const invalid = (error: string) => NextResponse.json({ error }, { status: 400 })
  if (!body || typeof body !== 'object') return invalid('주문 정보를 입력해주세요.')
  if (body.paymentMethod !== undefined && !['bank', 'card'].includes(body.paymentMethod)) return invalid('결제 방식을 확인해주세요.')
  const card = body.paymentMethod === 'card'
  if (card && !allowedPayappOrigin(request.headers.get('origin'), request.url)) return NextResponse.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 })
  if (card && !payappConfig().enabled) return NextResponse.json({ error: '페이앱 카드결제 설정을 확인해주세요. 주문은 등록하지 않았습니다.' }, { status: 503 })
  if (card && (typeof body.cardRequestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.cardRequestId))) return invalid('카드 주문 요청번호를 확인해주세요.')
  const importSourceId = body.importSourceId
  if (importSourceId !== undefined && (typeof importSourceId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/.test(importSourceId))) return invalid('상담 원본 정보가 올바르지 않습니다. 다시 가져와주세요.')
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const phone = typeof body.phone === 'string' ? body.phone.replace(/\D/g, '') : ''
  const address = typeof body.address === 'string' ? body.address.trim() : ''
  if (!name || name.length > 100 || !/^0\d{8,10}$/.test(phone) || !address || address.length > 500) {
    return invalid('이름, 올바른 전화번호, 배송 주소를 입력해주세요.')
  }
  if (card && !/^01\d{8,9}$/.test(phone)) return invalid('카드결제 링크를 받을 휴대전화번호를 입력해주세요.')
  if (typeof body.skipSms !== 'boolean') return invalid('문자 발송 여부를 선택해주세요.')
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 100) return invalid('주문 상품을 선택해주세요.')
  let quote: Awaited<ReturnType<typeof quoteAdminShippingCart>>
  try { quote = await quoteAdminShippingCart(body.items) }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : '배송비 확인 실패' }, { status: error instanceof ShippingError ? error.status : 503 }) }
  const { items, total } = quote
  if (card && (!Number.isSafeInteger(total) || total < 1000)) return invalid('카드결제는 1,000원 이상 주문부터 가능합니다.')
  if (body.expectedTotal !== undefined && body.expectedTotal !== total) return NextResponse.json({ error: '가격 또는 배송처가 변경되었습니다. 다시 확인해주세요.' }, { status: 409 })
  const savedPhone = phone.startsWith('02')
    ? phone.replace(/^(02)(\d{3,4})(\d{4})$/, '$1-$2-$3')
    : phone.replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3')
  const { data: order, error } = await supabase.from('orders').insert({
    ...(importSourceId ? { id: importSourceId } : card ? { id: body.cardRequestId } : {}),
    customer_name: name, customer_phone: savedPhone, customer_address: address,
    customer_request: typeof body.request === 'string' ? body.request.trim().slice(0, 1000) : '',
    total_price: total, shipping_breakdown: quote.groups, status: card ? '결제대기' : '입금대기',
    ...(card ? { payment_method: 'PAYAPP:카드', payment_amount: total } : {}),
  }).select('*').single()
  if (error?.code === '23505' && card) return NextResponse.json({ error: '이미 접수된 카드 주문입니다. 중복 결제 요청과 문자를 발송하지 않았습니다. 주문 목록에서 확인해주세요.', orderId: importSourceId || body.cardRequestId }, { status: 409 })
  if (error?.code === '23505' && importSourceId) return NextResponse.json({ error: '동일한 상담 원본으로 이미 등록된 주문입니다. 주문 내역을 확인해주세요. 중복 등록과 문자 발송은 하지 않았습니다.' }, { status: 409 })
  if (error || !order) return NextResponse.json({ error: '주문 등록에 실패했습니다.' }, { status: 500 })
  const { error: itemError } = await supabase.from('order_items').insert(items.map(item => ({ ...item, order_id: order.id })))
  if (itemError) {
    const { error: rollbackError } = await supabase.from('orders').delete().eq('id', order.id)
    return NextResponse.json({ error: rollbackError ? `상품 저장에 실패했습니다. 주문 #${order.id.slice(0, 8)}을 확인한 후 다시 등록해주세요.` : '상품 저장에 실패했습니다. 다시 시도해주세요.' }, { status: 500 })
  }
  let sms = { sent: false, reason: 'excluded' }
  let payment: { payurl?: string; pending?: boolean; error?: string } | undefined
  if (card) {
    // The unique order ID is reserved before calling PayApp. A duplicate POST
    // cannot request another payment, even if the first response was lost.
    try {
      const response = await requestPayappPayment(order.id, total, phone, items, true)
      payment = await response.json()
    } catch { payment = { pending: true, error: '결제 요청 결과 확인이 필요합니다. 주문을 다시 등록하지 마세요.' } }
  }
  if (!body.skipSms && (!card || payment?.payurl)) {
    try {
      const response = await notifyOrder(new Request(request.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: order.id }) }), card ? { cardPayurl: payment?.payurl } : undefined)
      sms = await response.json()
    } catch { sms = { sent: false, reason: 'failed' } }
  }
  return NextResponse.json({ order, sms, ...(card ? { payment } : {}) }, { status: 201 })
}

export async function GET(request: NextRequest) {
  if (!(await receiptAdmin(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Supabase caps a single response. Always fetch every page with a unique
  // ordering so refreshing never replaces the cumulative total with a subset.
  const snapshotAt = new Date().toISOString()
  const orders: DbOrder[] = []
  for (let start = 0; ; start += 500) {
    const { data, error } = await supabase.from('orders').select('*').lte('created_at', snapshotAt)
      .order('created_at', { ascending: false }).order('id', { ascending: true })
      .range(start, start + 499)
    if (error) return NextResponse.json({ error: '전체 주문 조회에 실패했습니다. 다시 시도해주세요.' }, { status: 503 })
    const page = (data ?? []) as DbOrder[]
    orders.push(...page)
    if (page.length < 500) break
  }
  if (orders.some(order => (order.customer_request || '').includes('\n[[ORDER_EDIT_LOCK:'))) return NextResponse.json({ error: '주문 수정이 진행 중입니다. 잠시 후 새로고침해주세요.' }, { status: 503 })
  const uniqueOrders = Array.from(new Map(orders.map(order => [order.id, order])).values())
  orders.splice(0, orders.length, ...uniqueOrders)
  const { data: itemRows, error: itemError } = await fetchOrderItemsForOrders(
    orders.map((order) => order.id),
  )

  if (itemError) {
    return NextResponse.json({ error: itemError.message }, { status: 500 })
  }

  const items = (itemRows ?? []) as DbOrderItem[]
  const itemsByOrder = new Map<string, DbOrderItem[]>()
  for (const item of items) {
    const group = itemsByOrder.get(item.order_id)
    if (group) group.push(item)
    else itemsByOrder.set(item.order_id, [item])
  }
  let receipts = new Map()
  let receiptWarning = ''
  if ((await receiptAdmin(request))) {
    try { receipts = await receiptSummaries(orders.map(order => order.id)) } catch { receiptWarning = '현금영수증 저장소를 확인해주세요.' }
  } else receiptWarning = '현금영수증 조회·발급을 위해 관리자에서 다시 로그인해주세요.'
  const ordersWithItems = orders.map((order) => ({
    ...order,
    items: itemsByOrder.get(order.id) ?? [],
    cash_receipt: receipts.get(order.id) ?? null,
  }))

  return NextResponse.json(
    { orders: ordersWithItems, receiptWarning },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    },
  )
}
