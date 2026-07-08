import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

type KShotTestBody = {
  token?: string
  key?: string
  user_id?: string
  sender?: string
  receiver?: string
  msg?: string
  title?: string
  testmode_yn?: string
}

const TOKEN = '9f43a7'
const KSHOT_URL = 'https://munjaro.net/apis/send/'

function normalizePhone(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '')
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as KShotTestBody

    if (body.token !== TOKEN) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }

    const key = String(body.key ?? '')
    const userId = String(body.user_id ?? 'cyj_001')
    const sender = normalizePhone(body.sender ?? '01091058444')
    const receiver = normalizePhone(body.receiver ?? '01033328459')
    const msg = String(body.msg ?? 'KShot Cloud Run testmode test')
    const title = String(body.title ?? 'API TEST')
    const testmodeYn = body.testmode_yn === 'N' ? 'N' : 'Y'

    if (!key) {
      return NextResponse.json({ error: 'missing_key' }, { status: 400 })
    }

    const form = new FormData()
    form.set('key', key)
    form.set('user_id', userId)
    form.set('sender', sender)
    form.set('receiver', receiver)
    form.set('msg', msg)
    form.set('title', title)
    form.set('testmode_yn', testmodeYn)

    const response = await fetch(KSHOT_URL, {
      method: 'POST',
      body: form,
    })

    const responseText = await response.text()
    let parsed: unknown = responseText
    try {
      parsed = JSON.parse(responseText)
    } catch {}

    return NextResponse.json({
      ok: response.ok,
      httpStatus: response.status,
      kshot: parsed,
      request: {
        user_id: userId,
        sender,
        receiver,
        testmode_yn: testmodeYn,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'unknown_error' },
      { status: 500 },
    )
  }
}
