type SendSmsInput = {
  receiver: string
  message: string
  title?: string
  templateCode?: string
}

type KshotResponse = {
  code?: string | number
  result?: string | number
  result_code?: string | number
  message?: string
  msg?: string
  [key: string]: unknown
}

type AdminSmsOptions = {
  title?: string
  templateCode?: string
}

const RESULT_MESSAGES: Record<string, string> = {
  '1': 'Success',
  '-101': 'Authentication failed: unknown user ID',
  '-102': 'Authentication failed: API permission missing',
  '-103': 'Missing parameter',
  '-104': 'Invalid parameter',
  '-107': 'Invalid User-Agent authentication key',
  '-109': 'Insufficient balance',
  '-110': 'Send failed',
  '-111': 'No send target',
  '-113': 'Message byte limit exceeded',
  '-115': 'Invalid phone number format',
  '-116': 'Emoji is not allowed',
}

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

function optional(name: string, fallback = ''): string {
  return process.env[name]?.trim() || fallback
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, '')
}

function normalizeSender(value: string): string {
  return value.replace(/\s/g, '')
}

function buildSmsUrl(): string {
  const directUrl = optional('KSHOT_SMS_URL')
  if (directUrl) return directUrl

  const baseUrl = required('KSHOT_BASE_URL').replace(/\/+$/, '')
  const endpoint = optional('KSHOT_SMS_ENDPOINT', '/apis/send/')
  return `${baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`
}

function buildAlimtalkUrl(): string {
  const directUrl = optional('KSHOT_ALIMTALK_URL')
  if (directUrl) return directUrl

  const baseUrl = required('KSHOT_BASE_URL').replace(/\/+$/, '')
  const endpoint = optional('KSHOT_ALIMTALK_ENDPOINT', '/apis/alimtalk/send')
  return `${baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`
}

function buildAlimtalkTargetList(receiver: string): string {
  const configured = optional('KSHOT_ALIMTALK_TARGET_LIST_FORMAT', 'object').toLowerCase()
  const target = { no: receiver }
  return configured === 'array' ? JSON.stringify([target]) : JSON.stringify(target)
}

function responseCode(body: KshotResponse): string {
  const code = body.result_code ?? body.code ?? body.result
  return code == null ? '' : String(code)
}

function isSuccessResponse(res: Response, body: KshotResponse): boolean {
  const code = responseCode(body)
  return res.ok && (code === '' || code === '1' || code === '200')
}

export function getAdminSmsReceivers(): string[] {
  const raw = optional('KSHOT_ADMIN_RECEIVERS', optional('ADMIN_SMS_RECEIVERS'))
  return raw
    .split(',')
    .map(receiver => normalizePhone(receiver))
    .filter(Boolean)
}

async function parseKshotResponse(res: Response): Promise<KshotResponse> {
  const text = await res.text()
  let body: KshotResponse
  try {
    body = JSON.parse(text) as KshotResponse
  } catch {
    body = { message: text }
  }

  if (!isSuccessResponse(res, body)) {
    const code = responseCode(body)
    const reason = body.message ?? body.msg ?? RESULT_MESSAGES[code] ?? res.statusText
    throw new Error(`KShot send failed (${code || res.status}): ${reason}`)
  }

  return body
}

async function sendKshotRestSms(input: SendSmsInput): Promise<KshotResponse> {
  const receiver = normalizePhone(input.receiver)
  if (!receiver) throw new Error('SMS receiver is empty')

  const userId = required('KSHOT_USER_ID')
  const apiKey = required('KSHOT_API_KEY')
  const sender = normalizeSender(required('KSHOT_SENDER'))
  const url = buildSmsUrl()

  const form = new FormData()
  form.set(optional('KSHOT_USER_ID_PARAM', 'user_id'), userId)
  form.set(optional('KSHOT_API_KEY_PARAM', 'key'), apiKey)
  form.set(optional('KSHOT_SENDER_PARAM', 'sender'), sender)
  form.set(optional('KSHOT_RECEIVER_PARAM', 'receiver'), receiver)
  form.set(optional('KSHOT_MESSAGE_PARAM', 'msg'), input.message)
  if (input.title) form.set(optional('KSHOT_TITLE_PARAM', 'title'), input.title)
  const testMode = optional('KSHOT_TESTMODE_YN')
  if (testMode) form.set('testmode_yn', testMode)

  const headers: HeadersInit = {}
  const userAgentHeader = optional('KSHOT_USER_AGENT')
  if (userAgentHeader) headers['User-Agent'] = userAgentHeader

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: form,
    cache: 'no-store',
  })

  return parseKshotResponse(res)
}

export async function sendKshotAlimtalk(input: SendSmsInput): Promise<KshotResponse> {
  const receiver = normalizePhone(input.receiver)
  if (!receiver) throw new Error('Alimtalk receiver is empty')

  const userId = required('KSHOT_USER_ID')
  const senderKey = required('KSHOT_ALIMTALK_SENDER_KEY')
  const templateCode = input.templateCode ?? required('KSHOT_ALIMTALK_TEMPLATE_CODE')
  const sender = normalizeSender(required('KSHOT_SENDER'))
  const url = buildAlimtalkUrl()

  const form = new URLSearchParams()
  form.set('uid', userId)
  form.set('senderKey', senderKey)
  form.set('sender', sender)
  form.set('templateCode', templateCode)
  form.set('msg', input.message)
  form.set('targetList', buildAlimtalkTargetList(receiver))

  const senderKeyType = optional('KSHOT_ALIMTALK_SENDER_KEY_TYPE')
  if (senderKeyType) form.set('senderKeyType', senderKeyType)

  const buttons = optional('KSHOT_ALIMTALK_BUTTONS')
  if (buttons) form.set('buttons', buttons)

  const replaceType = optional('KSHOT_ALIMTALK_REPLACE_TYPE', 'N')
  form.set('replaceType', replaceType)
  if (replaceType !== 'N') {
    form.set('replaceMsg', optional('KSHOT_ALIMTALK_REPLACE_MSG', input.message))
    if (input.title) form.set('title', input.title)
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
    cache: 'no-store',
  })

  return parseKshotResponse(res)
}

export async function sendKshotSms(input: SendSmsInput): Promise<KshotResponse> {
  const mode = optional('KSHOT_SEND_MODE', 'sms').toLowerCase()
  if (mode === 'alimtalk') return sendKshotAlimtalk(input)
  return sendKshotRestSms(input)
}

export async function sendAdminSms(message: string, titleOrOptions?: string | AdminSmsOptions): Promise<void> {
  const receivers = getAdminSmsReceivers()
  if (receivers.length === 0) throw new Error('KSHOT_ADMIN_RECEIVERS is not configured')

  const options = typeof titleOrOptions === 'string' ? { title: titleOrOptions } : titleOrOptions
  await Promise.all(receivers.map(receiver => sendKshotSms({
    receiver,
    message,
    title: options?.title,
    templateCode: options?.templateCode,
  })))
}
