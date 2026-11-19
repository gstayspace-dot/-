'use client'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname } from 'next/navigation'
import { installCustomerExitGuard, isCustomerRoute, registerCustomerExitConfirmation } from '@/lib/customer-navigation'

export default function CustomerExitGuard() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const answer = useRef<((approved: boolean) => void) | null>(null)
  const stay = useRef<HTMLButtonElement>(null), leave = useRef<HTMLButtonElement>(null)
  const title = useId()
  function choose(approved: boolean) {
    const resolve = answer.current
    answer.current = null
    setOpen(false)
    resolve?.(approved)
  }
  useEffect(() => {
    if (!isCustomerRoute(pathname)) return
    const unregister = registerCustomerExitConfirmation(() => new Promise(resolve => {
      if (answer.current) { resolve(false); return }
      answer.current = resolve
      setOpen(true)
    }))
    const uninstall = installCustomerExitGuard(window, document)
    return () => { uninstall(); unregister(); answer.current?.(false); answer.current = null; setOpen(false) }
  }, [pathname])
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    stay.current?.focus()
    return () => { document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus() }
  }, [open])
  if (!open) return null
  return createPortal(<div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-5" onClick={event => { if (event.target === event.currentTarget) choose(false) }}>
    <div role="alertdialog" aria-modal="true" aria-labelledby={title} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); choose(false) }
      if (event.key === 'Tab') {
        if (event.shiftKey && document.activeElement === stay.current) { event.preventDefault(); leave.current?.focus() }
        else if (!event.shiftKey && document.activeElement === leave.current) { event.preventDefault(); stay.current?.focus() }
      }
    }}>
      <h2 id={title} className="text-center text-xl font-bold text-gray-900">홈페이지를 나가시겠습니까?</h2>
      <p className="mt-3 text-center text-sm text-gray-600">계속 쇼핑하시려면 아래 버튼을 선택해주세요.</p>
      <div className="mt-6 flex gap-3">
        <button ref={stay} type="button" onClick={() => choose(false)} className="min-h-12 flex-1 rounded-xl bg-orange-500 px-3 py-3 font-bold text-white">계속 쇼핑하기</button>
        <button ref={leave} type="button" onClick={() => choose(true)} className="min-h-12 rounded-xl border border-gray-300 px-5 py-3 font-bold text-gray-700">나가기</button>
      </div>
    </div>
  </div>, document.body)
}
