'use client'

import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'

export default function PurchaseConfirmDialog({ orderNow, onCancel, onConfirm }: {
  orderNow: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const titleId = useId()
  const cancelButton = useRef<HTMLButtonElement>(null)
  const confirmButton = useRef<HTMLButtonElement>(null)
  const confirmed = useRef(false)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    cancelButton.current?.focus()
    return () => {
      document.body.style.overflow = overflow
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  return createPortal(<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-5" onClick={event => {
    if (event.target === event.currentTarget) onCancel()
  }}>
    <div role="alertdialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); onCancel() }
      if (event.key === 'Tab') {
        if (event.shiftKey && document.activeElement === cancelButton.current) { event.preventDefault(); confirmButton.current?.focus() }
        else if (!event.shiftKey && document.activeElement === confirmButton.current) { event.preventDefault(); cancelButton.current?.focus() }
      }
    }}>
      <h2 id={titleId} className="text-center text-xl font-bold leading-relaxed text-gray-900">{orderNow ? '바로 주문 하시겠습니까?' : '장바구니에 담을까요?'}</h2>
      <div className="mt-6 flex gap-3">
        <button ref={cancelButton} type="button" onClick={onCancel} className="min-h-12 flex-1 rounded-xl border border-gray-300 px-4 py-3 text-lg font-bold text-gray-700">아니요</button>
        <button ref={confirmButton} type="button" onClick={() => {
          if (confirmed.current) return
          confirmed.current = true
          onConfirm()
        }} className="min-h-12 flex-1 rounded-xl bg-orange-500 px-4 py-3 text-lg font-bold text-white">예</button>
      </div>
    </div>
  </div>, document.body)
}
