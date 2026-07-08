import { NextResponse } from 'next/server'
import { ADMIN_PHONE, normalizePhone, sendSms, smsConfigured } from '@/lib/sms'

export const runtime = 'nodejs'

const MANAGER_PHONE = '01033328459'

type ChatNotifyRequest = {
  customerName?: string
  message?: string
}

export async function POST(request: Request) {
  let body: ChatNotifyRequest

  try {
    body = await request.json() as ChatNotifyRequest
  } catch {
    return NextResponse.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 })
  }

  const customerName = typeof body.customerName === 'string' ? body.customerName.trim() : '고객'
  const message = typeof body.message === 'string' ? body.message.trim() : ''

  if (!message) {
    return NextResponse.json({ sent: false, reason: 'empty_message' }, { status: 400 })
  }

  if (!smsConfigured()) {
    return NextResponse.json({ sent: false, reason: 'sms_not_configured' })
  }

  const recipients = Array.from(new Set([ADMIN_PHONE, MANAGER_PHONE].map(normalizePhone).filter(Boolean)))
  if (recipients.length === 0) {
    return NextResponse.json({ sent: false, reason: 'no_recipient' })
  }

  const preview = message.length > 120 ? `${message.slice(0, 120)}...` : message

  try {
    const results = await sendSms(recipients.map(to => ({
      to,
      subject: '[영진상사] 상담문의',
      text: [
        '[영진상사] 상담문의가 도착했습니다.',
        '',
        `고객명: ${customerName}`,
        `문의내용: ${preview}`,
        `담당자: ${MANAGER_PHONE}`,
      ].join('\n'),
    })))

    return NextResponse.json({ sent: true, count: results.length })
  } catch (error) {
    console.error('Failed to send chat SMS notification', error)
    return NextResponse.json(
      { sent: false, error: error instanceof Error ? error.message : '문자 발송에 실패했습니다.' },
      { status: 200 },
    )
  }
}
