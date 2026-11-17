import { NextResponse, type NextRequest } from 'next/server'
import { receiptAdmin } from '@/lib/receipt-admin-auth'
import { receiptDb } from '@/lib/receipt-db'
import { saveProductAvailability } from '@/lib/supabaseClient'

export const dynamic = 'force-dynamic'

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  if (!await receiptAdmin(request)) return NextResponse.json({ error: '관리자 로그인이 필요합니다.' }, { status: 401 })
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.id) || params.id.startsWith('00000000-')) return NextResponse.json({ error: '상품을 확인해주세요.' }, { status: 400 })
  try {
    const body = await request.json()
    if (typeof body?.isSoldOut !== 'boolean' || typeof body?.expected !== 'boolean') return NextResponse.json({ error: '품절 설정을 확인해주세요.' }, { status: 400 })
    const db = receiptDb()
    if (!db) return NextResponse.json({ error: '서버 설정을 확인해주세요.' }, { status: 503 })
    const { data, error } = await db.from('products').select('id,quantity').eq('id', params.id).single()
    if (error || !data) return NextResponse.json({ error: '상품을 찾지 못했습니다.' }, { status: 404 })
    const saveError = await saveProductAvailability(params.id, body.isSoldOut, body.expected)
    if (saveError) return NextResponse.json({ error: saveError.message }, { status: 409 })
    return NextResponse.json({ ok: true, isSoldOut: body.isSoldOut, quantity: data.quantity }, { headers: { 'Cache-Control': 'no-store' } })
  } catch { return NextResponse.json({ error: '품절 설정을 저장하지 못했습니다. 다시 시도해주세요.' }, { status: 400 }) }
}
