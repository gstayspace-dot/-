const KSHOT_URL = 'https://munjaro.net/apis/send/'

const USER_ID = process.env.KSHOT_USER_ID ?? 'cyj_001'
const SENDER = process.env.KSHOT_SENDER ?? '01091058444'
const TEST_MODE = process.env.KSHOT_TEST_MODE ?? 'N'

export type SmsMessage = {
  to: string
  text: string
  subject?: string
}

type KShotResponse = {
  result_code?: number | string
  message?: string
  msg_id?: number | string
  success_cnt?: number | string
  error_cnt?: number | string
  msg_type?: string
  [key: string]: unknown
}

export function normalizePhone(phone: string) {
  return phone.replace(/\D/g, '')
}

export const ADMIN_PHONE = normalizePhone(process.env.ADMIN_PHONE ?? '')

export function smsConfigured() {
  return Boolean(process.env.KSHOT_API_KEY && USER_ID && SENDER)
}

export async function sendSms(messages: SmsMessage[]) {
  const apiKey = process.env.KSHOT_API_KEY
  const sender = normalizePhone(SENDER)

  if (!apiKey) {
    throw new Error('KSHOT_API_KEY is not configured')
  }
  if (!USER_ID || !sender) {
    throw new Error('KShot sender configuration is incomplete')
  }

  const results: KShotResponse[] = []

  for (const message of messages) {
    const receiver = normalizePhone(message.to)
    if (receiver.length < 9) {
      throw new Error('Invalid receiver phone number')
    }

    const form = new FormData()
    form.set('key', apiKey)
    form.set('user_id', USER_ID)
    form.set('sender', sender)
    form.set('receiver', receiver)
    form.set('msg', message.text)
    form.set('testmode_yn', TEST_MODE)

    if (message.subject) {
      form.set('title', message.subject)
    }

    const response = await fetch(KSHOT_URL, {
      method: 'POST',
      body: form,
    })
    const responseText = await response.text()

    let parsed: KShotResponse
    try {
      parsed = JSON.parse(responseText) as KShotResponse
    } catch {
      parsed = { message: responseText }
    }

    if (!response.ok) {
      throw new Error(`KShot HTTP ${response.status}: ${parsed.message ?? responseText}`)
    }

    const resultCode = Number(parsed.result_code)
    if (Number.isFinite(resultCode) && resultCode < 1) {
      throw new Error(`KShot error ${parsed.result_code}: ${parsed.message ?? responseText}`)
    }

    results.push(parsed)
  }

  return results
}
