import { NextResponse } from 'next/server'
import { sendAdminSms } from '@/lib/kshot'

type ChatNotificationBody = {
  customerId?: string
  customerName?: string
  text?: string
}

export const dynamic = 'force-dynamic'

function getOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL
    ?? process.env.PUBLIC_SITE_URL
    ?? process.env.SITE_URL
  if (configured?.trim()) return configured.trim().replace(/\/+$/, '')

  const proto = request.headers.get('x-forwarded-proto') ?? 'https'
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  return host ? `${proto}://${host}` : ''
}

function buildMessage(body: ChatNotificationBody, adminUrl: string): string {
  return [
    `[\uC0C1\uB2F4] ${body.customerName ?? body.customerId ?? '-'} \uBB38\uC758`,
    adminUrl,
  ].filter(Boolean).join('\n')
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatNotificationBody
    if (!body.text?.trim()) {
      return NextResponse.json({ ok: false, message: 'text is required' }, { status: 400 })
    }

    const origin = getOrigin(request)
    const adminUrl = origin && body.customerId
      ? `${origin}/admin/chat?customer=${encodeURIComponent(body.customerId)}`
      : origin
        ? `${origin}/admin/chat`
        : ''

    await sendAdminSms(buildMessage(body, adminUrl), {
      title: '\uC0C1\uB2F4 \uBB38\uC758 \uC54C\uB9BC',
      templateCode: process.env.KSHOT_ALIMTALK_CHAT_ADMIN_TEMPLATE_CODE,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('chat notification failed', error)
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : 'notification failed' },
      { status: 502 },
    )
  }
}
