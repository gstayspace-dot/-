import { NextResponse, type NextRequest } from 'next/server'
import { receiptAdmin } from '@/lib/receipt-admin-auth'
import { supabase, fetchOrderItemsForOrders } from '@/lib/supabaseClient'
import { normalizePhone, sendSms, smsConfigured } from '@/lib/sms'
import { editedOrderMessage } from '@/lib/admin-order-message'

export const dynamic = 'force-dynamic'
const invalid = (error: string, status = 400) => NextResponse.json({ sent: false, error }, { status })

export async function POST(request: NextRequest) {
  if (!(await receiptAdmin(request))) return invalid('관리자로 다시 로그인해주세요.', 401)
  let body
  try { body = await request.json() } catch { return invalid('잘못된 요청입니다.') }
  if (typeof body?.orderId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.orderId)) return invalid('주문번호를 확인해주세요.')
  const { data: order, error } = await supabase.from('orders').select('*').eq('id', body.orderId).maybeSingle()
  if (error) return invalid('주문 조회에 실패했습니다.', 503)
  if (!order || order.deleted_at) return invalid('주문을 찾을 수 없습니다.', 404)
  if ((order.customer_request ?? '').includes('\n[[ORDER_EDIT_LOCK:')) return invalid('주문 수정 또는 문자 발송이 진행 중입니다. 잠시 후 다시 시도해주세요.', 409)
  if (!/^0\d{8,10}$/.test(normalizePhone(order.customer_phone))) return invalid('저장된 연락처를 확인해주세요.')
  if (!smsConfigured()) return invalid('문자 발송 설정을 확인해주세요.', 503)

  // Use the existing edit lease so another editor or instance cannot send an intermediate order.
  const lock = `${order.customer_request ?? ''}\n[[ORDER_EDIT_LOCK:SMS:${crypto.randomUUID()}]]`
  let claim = supabase.from('orders').update({ customer_request: lock }).eq('id', order.id).eq('customer_phone', order.customer_phone).eq('customer_address', order.customer_address).eq('total_price', order.total_price).eq('status', order.status).eq('customer_name', order.customer_name)
  claim = order.customer_request == null ? claim.is('customer_request', null) : claim.eq('customer_request', order.customer_request)
  const claimed = await claim.select('id')
  if (claimed.error || !claimed.data?.length) return invalid('주문이 변경되었거나 다른 발송이 진행 중입니다. 목록을 새로고침해주세요.', 409)

  let sent = false, failure = '', uncertain = false, released = false
  try {
    const current = await supabase.from('orders').select('*').eq('id', order.id).eq('customer_request', lock).maybeSingle()
    if (current.error || !current.data || current.data.deleted_at) throw new Error('저장된 주문을 다시 조회하지 못했습니다.')
    const rows = await fetchOrderItemsForOrders([order.id])
    if (rows.error || !rows.data?.length) throw new Error('저장된 주문 상품을 조회하지 못했습니다.')
    uncertain = true
    await sendSms([editedOrderMessage(current.data, rows.data)])
    uncertain = false
    sent = true
  } catch {
    failure = uncertain ? '발송 결과를 확인하지 못했습니다. 이미 전송되었을 수 있으니 수신 여부를 확인한 뒤 재발송해주세요.' : '주문 또는 상품을 조회하지 못해 문자를 발송하지 않았습니다. 목록을 새로고침해주세요.'
    console.error('Administrator order SMS resend failed', { orderId: order.id, deliveryUncertain: uncertain })
  } finally {
    try {
      const release = await supabase.from('orders').update({ customer_request: order.customer_request }).eq('id', order.id).eq('customer_request', lock).select('id')
      released = !release.error && Boolean(release.data?.length)
    } catch { released = false }
  }
  if (sent) return NextResponse.json({ sent: true, ...(!released ? { warning: '문자 재발송은 완료됐으나 주문 잠금 해제를 확인해야 합니다. 중복 발송하지 말고 목록을 새로고침해주세요.' } : {}) })
  return NextResponse.json({ sent: false, error: failure, deliveryUncertain: uncertain, retryAllowed: released }, { status: 502 })
}
