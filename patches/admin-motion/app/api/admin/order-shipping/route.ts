import { NextResponse, type NextRequest } from 'next/server'
import { receiptAdmin } from '@/lib/receipt-admin-auth'
import { quoteAdminShippingCart, ShippingError } from '@/lib/shipping-server'

export const dynamic = 'force-dynamic'
export async function POST(request: NextRequest) {
  if (!(await receiptAdmin(request))) return NextResponse.json({ error: '관리자로 다시 로그인해주세요.' }, { status: 401 })
  let body
  try { body = await request.json() } catch { return NextResponse.json({ error: '주문 상품을 확인해주세요.' }, { status: 400 }) }
  try {
    return NextResponse.json(await quoteAdminShippingCart(body?.items), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '배송비 확인 실패' }, { status: error instanceof ShippingError ? error.status : 503 })
  }
}
