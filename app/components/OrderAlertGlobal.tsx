'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase, type DbOrder } from '@/lib/supabaseClient'

export default function OrderAlertGlobal() {
  const [isAdmin, setIsAdmin] = useState(false)
  const [toast, setToast] = useState<{ name: string; total: number; phone: string } | null>(null)
  const audioCtx = useRef<AudioContext | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Check admin session
  useEffect(() => {
    fetch('/api/admin/me')
      .then(r => r.json())
      .then(d => { if (d?.role) setIsAdmin(true) })
      .catch(() => {})
  }, [])

  function playAlert() {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Ctx = window.AudioContext || (window as any).webkitAudioContext
      if (!audioCtx.current) audioCtx.current = new Ctx()
      const ctx = audioCtx.current
      if (ctx.state === 'suspended') ctx.resume()
      // Three ascending tones
      ;[880, 1100, 1320].forEach((freq, i) => {
        const osc  = ctx.createOscillator()
        const gain = ctx.createGain()
        const t    = ctx.currentTime + i * 0.18
        osc.type = 'sine'
        osc.frequency.value = freq
        gain.gain.setValueAtTime(0, t)
        gain.gain.linearRampToValueAtTime(0.45, t + 0.015)
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45)
        osc.connect(gain); gain.connect(ctx.destination)
        osc.start(t); osc.stop(t + 0.5)
      })
    } catch { /* blocked on first load — first user gesture will unlock */ }
  }

  useEffect(() => {
    if (!isAdmin) return

    const channel = supabase
      .channel('global-order-alert-v2')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders' },
        (payload) => {
          const order = payload.new as DbOrder
          playAlert()
          if (timer.current) clearTimeout(timer.current)
          setToast({ name: order.customer_name, total: order.total_price, phone: order.customer_phone })
          timer.current = setTimeout(() => setToast(null), 10000)
        },
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin])

  if (!toast) return null

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] w-[90vw] max-w-sm">
      <div className="bg-green-600 text-white rounded-2xl shadow-2xl px-5 py-4 flex items-start gap-3 animate-fade-in">
        <span className="text-2xl flex-shrink-0 mt-0.5">🛎</span>
        <div className="flex-1 min-w-0">
          <p className="font-black text-base leading-tight">새 주문이 접수됐습니다!</p>
          <p className="text-sm opacity-90 mt-0.5 truncate">{toast.name} · {toast.phone}</p>
          <p className="text-sm font-black mt-1">₩{toast.total.toLocaleString()}</p>
        </div>
        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          <button
            onClick={() => setToast(null)}
            className="text-white/70 hover:text-white text-xl leading-none"
          >
            ×
          </button>
          <a
            href="/admin/orders"
            onClick={() => setToast(null)}
            className="text-[11px] bg-white/20 hover:bg-white/30 font-bold px-2.5 py-1 rounded-lg transition-colors whitespace-nowrap"
          >
            주문 확인 →
          </a>
        </div>
      </div>
    </div>
  )
}
