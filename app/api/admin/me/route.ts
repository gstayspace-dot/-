import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const token = request.cookies.get('admin_token')?.value
  if (token === 'tlc_admin_super_v1') return NextResponse.json({ role: 'super' })
  if (token === 'tlc_admin_v1') return NextResponse.json({ role: 'sub' })
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
