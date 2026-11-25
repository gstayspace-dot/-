import { quoteShippingCart, ShippingError } from '@/lib/shipping-server'
import { parseReceiptChoice, receiptsReady, saveReceiptChoice } from '@/lib/cash-receipt'
import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabaseClient'
import { allowedPayappOrigin, payappConfig } from '@/lib/payapp'
import { requestPayappPayment } from '@/lib/payapp-request'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
async function databaseReady() {
  const { error } = await supabase.from('orders').select('payment_key,payment_amount,payment_method,payment_confirmed_at').limit(0)
  return !error
}
export async function GET() {
  return NextResponse.json({ enabled: payappConfig().enabled && await databaseReady(), receiptsEnabled: await receiptsReady() }, { headers: { 'Cache-Control': 'no-store' } })
}
export async function POST(request: Request) {
  const config = payappConfig()
  const origin = request.headers.get('origin')
  const allowedOrigin = allowedPayappOrigin(origin, request.url)
  if (!allowedOrigin) return NextResponse.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 })
  if (!await databaseReady()) return NextResponse.json({ error: '결제 데이터 설정이 준비 중입니다.' }, { status: 503 })
  const invalid = (error: string) => NextResponse.json({ error }, { status: 400 })
  let body
  try { body = await request.json() } catch { return invalid('요청 형식을 확인해주세요.') }
  if (!body || typeof body !== 'object') return invalid('주문 정보를 확인해주세요.')
  const method = body.method === 'bank' ? 'bank' : body.method === 'toss' ? 'toss' : 'payapp'
  if (method === 'payapp' && !config.enabled) return NextResponse.json({ error: '페이앱 결제는 준비 중입니다.' }, { status: 503 })
  let receipt
  try { receipt = parseReceiptChoice(body.receipt) } catch (error) { return invalid(error instanceof Error ? error.message : '현금영수증 신청 정보를 확인해주세요.') }
  if (receipt.requested && !await receiptsReady()) return NextResponse.json({ error: '현금영수증 발급 설정이 준비 중입니다.' }, { status: 503 })
  const id = typeof body.id === 'string' ? body.id : ''
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const phone = typeof body.phone === 'string' ? body.phone.replace(/\D/g, '') : ''
  const address = typeof body.address === 'string' ? body.address.trim() : ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) || !name || name.length > 100 || !/^01\d{8,9}$/.test(phone) || !address || address.length > 500) return invalid('이름, 휴대전화번호, 배송 주소를 확인해주세요.')
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 100) return invalid('주문 상품을 확인해주세요.')
  let quote: Awaited<ReturnType<typeof quoteShippingCart>>
  try { quote = await quoteShippingCart(body.items) }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : '배송비 확인 실패' }, { status: error instanceof ShippingError ? error.status : 503 }) }
  const { items, total } = quote
  if (!Number.isSafeInteger(total) || total < 1000) return invalid('결제 금액을 확인해주세요.')
  if (body.expectedTotal !== total) return NextResponse.json({ error: '상품 가격이 변경되었습니다. 장바구니를 새로 확인해주세요.', retrySafe: true }, { status: 409 })
  const fullRequest = (method === 'bank' ? '[계좌이체] | ' : method === 'toss' ? '[토스결제] | ' : '[페이앱결제] | ') + (typeof body.request === 'string' ? body.request.trim().slice(0,1000) : '')
  const { error: orderError } = await supabase.from('orders').insert({ id, customer_name: name, customer_phone: phone, customer_address: address, customer_request: fullRequest, total_price: total, shipping_breakdown: quote.groups, status: method === 'bank' ? '입금대기' : '결제대기' })
  if (orderError) return NextResponse.json({ error: orderError.code === '23505' ? '이미 접수한 결제 요청입니다. 내 주문에서 확인해주세요.' : '주문 등록에 실패했습니다.' }, { status: 409 })
  try { await saveReceiptChoice(id, receipt) } catch {
    await supabase.from('orders').update({ status: '결제요청실패' }).eq('id', id)
    return NextResponse.json({ error: '현금영수증 신청 저장에 실패했습니다. 결제는 요청하지 않았습니다.', retrySafe: true }, { status: 500 })
  }
  const { error: itemError } = await supabase.from('order_items').insert(items.map(item => ({ ...item, order_id: id })))
  if (itemError) {
    await supabase.from('orders').update({ status: '결제요청실패' }).eq('id', id)
    return NextResponse.json({ error: '주문 상품 저장에 실패했습니다. 결제는 요청하지 않았습니다.' }, { status: 500 })
  }
  if (method !== 'payapp') return NextResponse.json({ orderId: id, total, fullRequest, shippingBreakdown: quote.groups })
  return requestPayappPayment(id, total, phone, items)
}
