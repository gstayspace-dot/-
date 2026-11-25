import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabaseClient'
import { PAYAPP_ORIGIN, payappConfig, payappToken, trustedPayurl } from '@/lib/payapp'

// Called once after a uniquely identified order and its items have been saved.
// Never retries uncertain provider requests; approval is handled only by feedbackurl.
export async function requestPayappPayment(id: string, total: number, phone: string, items: { product_name: string }[], cardOnly = false) {
  const config = payappConfig()
  const token = payappToken('return', id, total)
  try {
    const response = await fetch('https://api.payapp.kr/oapi/apiLoad.html', {
      method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(20000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ cmd: 'payrequest', userid: config.userid, goodname: `${items[0].product_name}${items.length > 1 ? ` 외 ${items.length - 1}건` : ''}`, price: String(total), recvphone: phone, reqaddr: '0', smsuse: 'n', feedbackurl: `${PAYAPP_ORIGIN}/api/payapp/feedback`, returnurl: `${PAYAPP_ORIGIN}/payment/payapp?id=${id}&token=${token}`, var1: id, var2: payappToken('payment', id, total), checkretry: 'y', openpaytype: cardOnly ? 'card' : 'card,kakaopay,naverpay,smilepay,applepay,payco,tosspay,rbank,vbank,myaccount' }),
    })
    const result = new URLSearchParams(await response.text())
    if (!response.ok || result.get('state') !== '1') {
      await supabase.from('orders').update({ status: '결제요청실패' }).eq('id', id).eq('status', '결제대기')
      return NextResponse.json({ error: '페이앱 결제 요청에 실패했습니다. 판매자 결제 설정을 확인해주세요.', retrySafe: !cardOnly }, { status: 502 })
    }
    const mulNo = result.get('mul_no') ?? ''
    if (!/^\d+$/.test(mulNo)) throw new Error('Invalid transaction')
    const payurl = trustedPayurl(result.get('payurl') ?? '')
    const { error } = await supabase.from('orders').update({ payment_key: `payapp:${mulNo}`, payment_method: cardOnly ? 'PAYAPP:카드' : 'PAYAPP', payment_amount: total }).eq('id', id).eq('status', '결제대기')
    if (error) throw new Error('Transaction save failed')
    return NextResponse.json({ orderId: id, payurl, total, token })
  } catch {
    // A timeout can leave a valid payment request at the provider. Keep the order
    // pending and its id stable so a retry cannot create another charge request.
    return NextResponse.json({ error: '결제 요청 결과를 확인하지 못했습니다. 중복 결제를 피하기 위해 내 주문에서 확인해주세요.', orderId: id, token, pending: true }, { status: 502 })
  }
}
