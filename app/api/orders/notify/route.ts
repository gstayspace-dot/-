import { NextResponse } from 'next/server'
import { ADMIN_PHONE, normalizePhone, sendSms, smsConfigured, type SmsMessage } from '@/lib/sms'
import { supabase, type DbOrder, type DbOrderItem } from '@/lib/supabaseClient'

export const runtime = 'nodejs'

const MANAGER_PHONE = '01033328459'

type NotifyRequest = {
  orderId?: string
}

function shortOrderId(id: string) {
  return id.slice(0, 8).toUpperCase()
}

function money(value: number) {
  return `${value.toLocaleString('ko-KR')}원`
}

function itemLines(items: DbOrderItem[]) {
  if (items.length === 0) return '- 주문 상품 없음'

  return items
    .map(item => `- ${item.product_name} ${item.quantity}개 (${money(item.price * item.quantity)})`)
    .join('\n')
}

function priceBreakdown(order: DbOrder, items: DbOrderItem[]) {
  const productTotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const shippingFee = Math.max(order.total_price - productTotal, 0)

  return [
    `물건값 ${money(productTotal)}`,
    `배송비 ${money(shippingFee)}`,
    `결제금액 ${money(order.total_price)}`,
  ].join('\n')
}

function isRecentlyCreated(order: DbOrder) {
  const createdAt = new Date(order.created_at).getTime()
  if (!Number.isFinite(createdAt)) return true

  return Date.now() - createdAt < 30 * 60 * 1000
}

export async function POST(request: Request) {
  let body: NotifyRequest

  try {
    body = await request.json() as NotifyRequest
  } catch {
    return NextResponse.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 })
  }

  const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : ''
  if (!/^[0-9a-f-]{20,}$/i.test(orderId)) {
    return NextResponse.json({ error: '주문번호가 올바르지 않습니다.' }, { status: 400 })
  }

  const { data: orderRow, error: orderError } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .maybeSingle()

  if (orderError) {
    console.error('Failed to load order for SMS notification', orderError)
    return NextResponse.json({ error: '주문 조회에 실패했습니다.' }, { status: 500 })
  }

  if (!orderRow) {
    return NextResponse.json({ error: '주문을 찾을 수 없습니다.' }, { status: 404 })
  }

  const order = orderRow as DbOrder
  if (!isRecentlyCreated(order)) {
    return NextResponse.json({ sent: false, reason: 'order_too_old' }, { status: 409 })
  }

  const { data: itemRows, error: itemsError } = await supabase
    .from('order_items')
    .select('*')
    .eq('order_id', orderId)

  if (itemsError) {
    console.error('Failed to load order items for SMS notification', itemsError)
    return NextResponse.json({ error: '주문 상품 조회에 실패했습니다.' }, { status: 500 })
  }

  if (!smsConfigured()) {
    return NextResponse.json({ sent: false, reason: 'sms_not_configured' })
  }

  const items = (itemRows ?? []) as DbOrderItem[]
  const orderNo = shortOrderId(order.id)
  const itemsText = itemLines(items)
  const pricesText = priceBreakdown(order, items)
  const messages: SmsMessage[] = [
    {
      to: order.customer_phone,
      subject: '[영진상사] 주문접수',
      text: [
        '[영진상사] 주문이 접수되었습니다.',
        '',
        `주문번호: #${orderNo}`,
        `주문자: ${order.customer_name}`,
        '',
        '[주문 상품]',
        itemsText,
        pricesText,
        `상태: ${order.status}`,
        `담당자: ${MANAGER_PHONE}`,
        '',
        '입금계좌: 국민은행 233001-04-329449 최영진(영진상사)',
        '입금 확인 후 배송 준비가 진행됩니다. 감사합니다.',
      ].join('\n'),
    },
  ]

  if (ADMIN_PHONE) {
    messages.push({
      to: ADMIN_PHONE,
      subject: '[관리자] 신규 주문',
      text: [
        '[영진상사] 신규 주문 접수',
        '',
        `주문번호: #${orderNo}`,
        `주문자: ${order.customer_name}`,
        `연락처: ${normalizePhone(order.customer_phone)}`,
        `담당자: ${MANAGER_PHONE}`,
        `주소: ${order.customer_address}`,
        order.customer_request ? `요청: ${order.customer_request}` : '',
        '',
        '[상품]',
        itemsText,
        pricesText,
      ].filter(Boolean).join('\n'),
    })
  }

  try {
    const results = await sendSms(messages)
    return NextResponse.json({ sent: true, count: results.length, results })
  } catch (error) {
    console.error('Failed to send order SMS notification', error)
    return NextResponse.json(
      { sent: false, error: error instanceof Error ? error.message : '문자 발송에 실패했습니다.' },
      { status: 200 },
    )
  }
}
