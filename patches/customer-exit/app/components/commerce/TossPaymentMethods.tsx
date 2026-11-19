'use client'
import { withCustomerPayment } from '@/lib/customer-navigation'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

type PaymentRequest = { orderId: string; orderName: string; successUrl: string; failUrl: string; customerName: string; customerMobilePhone: string }
type Widgets = { setAmount: (value: { value: number; currency: 'KRW' }) => Promise<void> | void; renderPaymentMethods: (args: { selector: string; variantKey: string }) => Promise<unknown>; renderAgreement: (args: { selector: string; variantKey?: string }) => Promise<unknown>; requestPayment: (args: PaymentRequest) => Promise<void>; destroy?: () => void }
type Factory = (key: string) => { widgets: (args: { customerKey: string }) => Widgets }
export type TossPaymentHandle = { request: (amount: number, request: PaymentRequest) => Promise<void> }
let sdkPromise: Promise<Factory> | null = null
function loadSdk(): Promise<Factory> {
  const current = (window as unknown as { TossPayments?: Factory }).TossPayments
  if (current) return Promise.resolve(current)
  if (sdkPromise) return sdkPromise
  sdkPromise = new Promise<Factory>((resolve, reject) => {
    const script = document.createElement('script')
    const timer = setTimeout(() => { script.remove(); reject(new Error('결제창을 불러오지 못했습니다. 다시 시도해 주세요.')) }, 15000)
    script.src = 'https://js.tosspayments.com/v2/standard'; script.async = true
    script.onload = () => { clearTimeout(timer); const sdk = (window as unknown as { TossPayments?: Factory }).TossPayments; if (sdk) resolve(sdk); else reject(new Error('결제창 초기화에 실패했습니다.')) }
    script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('결제창 연결을 확인해 주세요.')) }
    document.head.appendChild(script)
  }).catch(err => { sdkPromise = null; throw err })
  return sdkPromise
}
const TossPaymentMethods = forwardRef<TossPaymentHandle, { clientKey: string; variantKey: string; amount: number; onReady: (ready: boolean) => void }>(function TossPaymentMethods({ clientKey, variantKey, amount, onReady }, ref) {
  const widget = useRef<Widgets | null>(null), latestAmount = useRef(amount)
  const [error, setError] = useState(''), [retry, setRetry] = useState(0)
  latestAmount.current = amount
  useImperativeHandle(ref, () => ({ async request(total, request) { if (!widget.current) throw new Error('결제창이 준비되지 않았습니다.'); await widget.current.setAmount({ value: total, currency: 'KRW' }); await withCustomerPayment(() => widget.current!.requestPayment(request)) } }), [])
  useEffect(() => {
    let active = true, instance: Widgets | null = null
    onReady(false); setError('')
    async function init() {
      const sdk = await loadSdk()
      if (!active) return
      let customerKey = localStorage.getItem('tlc_toss_customer_key')
      if (!customerKey) { customerKey = crypto.randomUUID(); localStorage.setItem('tlc_toss_customer_key', customerKey) }
      instance = sdk(clientKey).widgets({ customerKey })
      await instance.setAmount({ value: latestAmount.current, currency: 'KRW' })
      if (!active) return
      await instance.renderPaymentMethods({ selector: '#commerce-payment-methods', variantKey })
      if (!active) return
      await instance.renderAgreement({ selector: '#commerce-payment-agreement', variantKey: 'AGREEMENT' })
      if (active) { widget.current = instance; onReady(true) }
    }
    void init().catch(err => { if (active) setError(err instanceof Error ? err.message : '결제창 초기화에 실패했습니다.') })
    return () => { active = false; widget.current = null; instance?.destroy?.() }
  }, [clientKey, variantKey, retry, onReady])
  useEffect(() => { if (widget.current) Promise.resolve(widget.current.setAmount({ value: amount, currency: 'KRW' })).catch(() => { onReady(false); setError('결제금액을 갱신하지 못했습니다.') }) }, [amount, onReady])
  return <div className="space-y-2"><div id="commerce-payment-methods" /><div id="commerce-payment-agreement" />{error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error} <button type="button" onClick={() => setRetry(n => n + 1)} className="font-bold underline">다시 시도</button></p>}</div>
})
export default TossPaymentMethods
