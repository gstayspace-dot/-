import { NextResponse } from 'next/server'
import { findAdminAccount } from '@/lib/store'

const SUPER_ID = 'admin'
const SUPER_PW = 'admin1234'
const SUPER_TOKEN = 'tlc_admin_super_v1'
const SUB_TOKEN = 'tlc_admin_v1'

const COOKIE_OPTS = {
  httpOnly: true,
  path: '/',
  maxAge: 60 * 60 * 8,
  sameSite: 'lax' as const,
}

export async function POST(request: Request) {
  const { username, password } = await request.json()

  let token: string | null = null

  if (username === SUPER_ID && password === SUPER_PW) {
    token = SUPER_TOKEN
  } else {
    const account = findAdminAccount(username)
    if (account && account.password === password) {
      token = SUB_TOKEN
    }
  }

  if (!token) {
    return NextResponse.json(
      { error: '아이디 또는 비밀번호가 올바르지 않습니다.' },
      { status: 401 },
    )
  }

  const res = NextResponse.json({ success: true })
  res.cookies.set('admin_token', token, COOKIE_OPTS)
  // Non-httpOnly so client JS can read role for UI purposes
  res.cookies.set('admin_role', token === SUPER_TOKEN ? 'super' : 'sub', {
    ...COOKIE_OPTS,
    httpOnly: false,
  })
  return res
}
