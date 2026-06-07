import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getAdminAccounts, findAdminAccount, addAdminAccount, deleteAdminAccount } from '@/lib/store'

const SUPER_TOKEN = 'tlc_admin_super_v1'
const RESERVED = new Set(['admin'])

function isSuperAdmin(request: NextRequest): boolean {
  return request.cookies.get('admin_token')?.value === SUPER_TOKEN
}

export async function GET(request: NextRequest) {
  if (!isSuperAdmin(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json(
    getAdminAccounts().map(({ username, createdAt }) => ({ username, createdAt })),
  )
}

export async function POST(request: NextRequest) {
  if (!isSuperAdmin(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { username, password } = await request.json()

  if (!username || !password) {
    return NextResponse.json({ error: '아이디와 비밀번호를 입력하세요.' }, { status: 400 })
  }
  if (RESERVED.has(username)) {
    return NextResponse.json({ error: '사용할 수 없는 아이디입니다.' }, { status: 400 })
  }
  if (findAdminAccount(username)) {
    return NextResponse.json({ error: '이미 존재하는 아이디입니다.' }, { status: 409 })
  }

  addAdminAccount({ username, password, createdAt: new Date().toISOString() })
  return NextResponse.json({ success: true, username }, { status: 201 })
}

export async function DELETE(request: NextRequest) {
  if (!isSuperAdmin(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { username } = await request.json()
  const deleted = deleteAdminAccount(username)
  if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ success: true })
}
