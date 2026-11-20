import type { DbOrder, DbOrderItem } from '@/lib/supabaseClient'
import { BANK_INFO, BUSINESS_INFO } from '@/lib/business-info'
import type { SmsMessage } from '@/lib/sms'

/** Build from the saved order, never from browser-supplied customer or payment data. */
export function editedOrderMessage(order: DbOrder, items: DbOrderItem[]): SmsMessage {
  const money = (value: number) => `${value.toLocaleString('ko-KR')}원`
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const unpaidBank = !order.payment_key && !order.payment_confirmed_at && ['입금대기', '결제대기'].includes(order.status) && (!order.payment_method || /bank|계좌|무통장/i.test(order.payment_method))
  return {
    to: order.customer_phone,
    subject: `[${BUSINESS_INFO.shortName}] 주문 수정 안내`,
    text: [
      `[${BUSINESS_INFO.shortName}] 수정된 주문 내역을 안내드립니다.`,
      `주문번호: #${order.id.slice(0, 8).toUpperCase()}`,
      `주문자: ${order.customer_name}`,
      `배송주소: ${order.customer_address}`,
      '', '[주문 상품]',
      ...items.map(item => `- ${item.product_name} ${item.quantity}개 (${money(item.price * item.quantity)})`),
      '', `물건값: ${money(subtotal)}`,
      `배송비: ${money(Math.max(0, order.total_price - subtotal))}`,
      `총 주문금액: ${money(order.total_price)}`,
      `상태: ${order.status}`,
      ...(unpaidBank ? ['', '[입금계좌]', `${BANK_INFO.name} ${BANK_INFO.account}`, `예금주: ${BANK_INFO.holder}`] : []),
      '', `문의: ${BUSINESS_INFO.phone}`,
    ].join('\n'),
  }
}
