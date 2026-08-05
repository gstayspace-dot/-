import { NextResponse } from 'next/server'
import { sendAdminSms, sendKshotSms } from '@/lib/kshot'

type OrderNotificationBody = {
  orderId?: string
  customerName?: string
  customerPhone?: string
  totalPrice?: number
  paymentMethod?: string
  items?: Array<{
    productName?: string
    quantity?: number
  }>
}

export const dynamic = 'force-dynamic'

function formatPrice(value: unknown): string {
  const price = typeof value === 'number' && Number.isFinite(value) ? value : 0
  return `${price.toLocaleString('ko-KR')}\uC6D0`
}

function buildMessage(body: OrderNotificationBody): string {
  const orderNo = body.orderId ? body.orderId.slice(0, 8).toUpperCase() : '-'
  return `[\uC601\uC9C4\uC0C1\uC0AC] \uC8FC\uBB38\uC811\uC218 ${orderNo} ${formatPrice(body.totalPrice)}`
}

function buildAdminMessage(body: OrderNotificationBody): string {
  const orderNo = body.orderId ? body.orderId.slice(0, 8).toUpperCase() : '-'
  return `[\uC8FC\uBB38] ${orderNo} ${body.customerName ?? '-'} ${body.customerPhone ?? '-'} ${formatPrice(body.totalPrice)}`
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as OrderNotificationBody
    if (!body.customerPhone?.trim()) {
      return NextResponse.json({ ok: false, message: 'customerPhone is required' }, { status: 400 })
    }

    await Promise.all([
      sendKshotSms({
        receiver: body.customerPhone,
        message: buildMessage(body),
        title: '\uC8FC\uBB38 \uC644\uB8CC',
        templateCode: process.env.KSHOT_ALIMTALK_ORDER_CUSTOMER_TEMPLATE_CODE,
      }),
      sendAdminSms(buildAdminMessage(body), {
        title: '\uC0C8 \uC8FC\uBB38 \uC54C\uB9BC',
        templateCode: process.env.KSHOT_ALIMTALK_ORDER_ADMIN_TEMPLATE_CODE,
      }),
    ])
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('order notification failed', error)
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : 'notification failed' },
      { status: 502 },
    )
  }
}
