'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase, type DbChatCustomer, type DbChatMessage } from '@/lib/supabaseClient'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any
import type { ChatCustomer, ChatMessage } from '@/lib/chat-store'

// ── Types ─────────────────────────────────────────────────────────────────────

type AdminCustomer = ChatCustomer & {
  unread: number
  isNew: boolean
  color: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  '#FF4500', '#E91E8C', '#2196F3', '#4CAF50',
  '#FF9800', '#9C27B0', '#00BCD4', '#FF5722',
  '#795548', '#607D8B', '#3F51B5', '#F06292',
]

function colorFor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}

function countUnread(msgs: ChatMessage[]): number {
  let lastAdminIdx = -1
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].isAdmin) { lastAdminIdx = i; break }
  }
  return msgs.slice(lastAdminIdx + 1).filter(m => !m.isAdmin).length
}

function relTime(iso: string): string {
  const d = Date.now() - new Date(iso).getTime()
  if (d < 60000) return '방금'
  if (d < 3600000) return `${Math.floor(d / 60000)}분 전`
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
}

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
}

function mapMessage(row: DbChatMessage): ChatMessage {
  return { id: row.id, customerId: row.customer_id, text: row.text, isAdmin: row.is_admin, ts: row.created_at }
}

// ── Quick replies ─────────────────────────────────────────────────────────────

const QUICK_REPLIES = [
  '네, 현재 재고 있습니다! 😊',
  '오늘 주문 시 내일 도착합니다.',
  '12개월 무이자 가능합니다.',
  '선물 포장 서비스 제공합니다!',
  '인덕션 · 가스 모두 호환됩니다.',
  '뚜껑 포함 5종 세트입니다 ✅',
]

// ── Component ─────────────────────────────────────────────────────────────────

export default function AdminChatPage() {
  const [customers, setCustomers] = useState<AdminCustomer[]>([])
  const [msgMap, setMsgMap] = useState<Record<string, ChatMessage[]>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [inputText, setInputText] = useState('')
  const [isSuper, setIsSuper] = useState(false)

  const chatEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const selectedIdRef = useRef<string | null>(null)

  useEffect(() => { selectedIdRef.current = selectedId }, [selectedId])

  const selectedMessages = selectedId ? (msgMap[selectedId] ?? []) : []
  const selectedCustomer = customers.find(c => c.id === selectedId) ?? null
  const totalUnread = customers.reduce((acc, c) => acc + c.unread, 0)

  // ── Super admin check ─────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/admin/me')
      .then(r => r.json())
      .then(d => { if (d.role === 'super') setIsSuper(true) })
      .catch(() => {})
  }, [])

  // ── Mount: Supabase initial load + realtime subscription ─────────────────
  useEffect(() => {
    let isMounted = true

    // Initial load: fetch all customers and messages
    Promise.all([
      db.from('chat_customers').select('*').order('joined_at', { ascending: false }),
      db.from('chat_messages').select('*').order('created_at', { ascending: true }),
    ]).then(([res1, res2]: [{ data: unknown }, { data: unknown }]) => {
      if (!isMounted) return

      const custRows = res1.data as DbChatCustomer[] | null
      const msgRows  = res2.data as DbChatMessage[]  | null

      // Build message map
      const map: Record<string, ChatMessage[]> = {}
      ;(msgRows ?? []).forEach(row => {
        if (!map[row.customer_id]) map[row.customer_id] = []
        map[row.customer_id].push(mapMessage(row))
      })
      setMsgMap(map)

      // Build customer list with unread counts
      const initial: AdminCustomer[] = (custRows ?? []).map(c => ({
        id: c.id,
        name: c.name,
        joinedAt: c.joined_at,
        unread: countUnread(map[c.id] ?? []),
        isNew: false,
        color: colorFor(c.name),
      }))
      setCustomers(initial)
      if (initial.length > 0) setSelectedId(initial[0].id)
    })

    // Realtime: new customers + new messages
    const channel = supabase
      .channel('admin-chat-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_customers' },
        (payload) => {
          if (!isMounted) return
          const c = payload.new as DbChatCustomer
          setCustomers(prev => {
            if (prev.some(x => x.id === c.id)) return prev
            return [{
              id: c.id, name: c.name, joinedAt: c.joined_at,
              unread: 0, isNew: true, color: colorFor(c.name),
            }, ...prev]
          })
          setMsgMap(prev => ({ ...prev, [c.id]: prev[c.id] ?? [] }))
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (payload) => {
          if (!isMounted) return
          const row = payload.new as DbChatMessage
          const msg = mapMessage(row)

          setMsgMap(prev => {
            const existing = prev[msg.customerId] ?? []
            if (existing.some(m => m.id === msg.id)) return prev
            return { ...prev, [msg.customerId]: [...existing, msg] }
          })

          // Increment unread counter only for incoming customer messages
          if (!msg.isAdmin) {
            setCustomers(prev => prev.map(c =>
              c.id !== msg.customerId ? c : {
                ...c,
                unread: c.id === selectedIdRef.current ? 0 : c.unread + 1,
                isNew: c.id !== selectedIdRef.current,
              }
            ))
          }
        },
      )
      .subscribe()

    return () => {
      isMounted = false
      supabase.removeChannel(channel)
    }
  }, [])

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [selectedMessages.length])

  // ── Mark as read ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedId) return
    setCustomers(prev => prev.map(c => c.id === selectedId ? { ...c, unread: 0, isNew: false } : c))
    setInputText('')
    inputRef.current?.focus()
  }, [selectedId])

  // ── Send admin message ────────────────────────────────────────────────────
  async function sendMessage() {
    const text = inputText.trim()
    if (!text || !selectedId) return

    const msg: ChatMessage = {
      id: `a_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      customerId: selectedId,
      text,
      isAdmin: true,
      ts: new Date().toISOString(),
    }

    // Optimistic update
    setMsgMap(prev => ({ ...prev, [selectedId]: [...(prev[selectedId] ?? []), msg] }))
    setInputText('')

    const row: DbChatMessage = {
      id:          msg.id,
      customer_id: msg.customerId,
      text:        msg.text,
      is_admin:    true,
      created_at:  msg.ts,
    }
    await db.from('chat_messages').insert(row)
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="h-screen flex flex-col bg-gray-50 overflow-hidden">

      {/* ── NAV ── */}
      <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between flex-shrink-0 shadow-sm z-10">
        <div className="flex items-center gap-3">
          <span className="text-xl font-black text-gray-900">🛠 관리자</span>
          <span className="text-gray-300">|</span>
          <span className="text-sm text-gray-600">실시간 1:1 채팅 상담</span>
          {totalUnread > 0 && (
            <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full animate-pulse">
              {totalUnread}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4 text-sm">
          {isSuper && (
            <a href="/admin/accounts" className="text-purple-500 hover:text-purple-400 font-semibold transition-colors">
              👑 계정 관리
            </a>
          )}
          <a href="/admin/products" className="text-gray-400 hover:text-gray-700 transition-colors">📦 상품 관리</a>
          <a href="/admin/orders" className="text-gray-400 hover:text-gray-700 transition-colors">📋 주문 관리</a>
          <a href="/" target="_blank" rel="noopener noreferrer" className="text-orange-500 hover:text-orange-600 font-semibold transition-colors">
            📺 라이브 페이지 →
          </a>
          <button
            onClick={async () => { await fetch('/api/admin/logout', { method: 'POST' }); window.location.href = '/admin/login' }}
            className="text-sm text-gray-400 hover:text-red-500 transition-colors font-medium"
          >
            로그아웃
          </button>
        </div>
      </nav>

      {/* ── MAIN ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ════════════════ LEFT: Customer List ════════════════ */}
        <aside className="w-72 xl:w-80 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col overflow-hidden">

          <div className="px-4 py-3 border-b border-gray-100 flex-shrink-0 flex items-center justify-between">
            <h2 className="font-bold text-gray-800 text-sm">👥 접속 고객</h2>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              <span className="text-xs text-gray-500 font-medium">{customers.length}명</span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto no-scrollbar">
            {customers.length === 0 ? (
              <div className="text-center py-12 text-sm text-gray-400">
                <div className="text-3xl mb-3">👤</div>
                고객 페이지를 열면<br />여기에 표시됩니다
              </div>
            ) : customers.map(c => {
              const msgs = msgMap[c.id] ?? []
              const last = msgs[msgs.length - 1]
              const isActive = c.id === selectedId
              return (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-100 transition-all hover:bg-orange-50 ${
                    isActive
                      ? 'bg-orange-50 border-l-[3px] border-l-orange-500'
                      : 'border-l-[3px] border-l-transparent'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="relative flex-shrink-0">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-extrabold shadow-sm"
                        style={{ backgroundColor: c.color }}
                      >
                        {c.name.replace('익명_', '')}
                      </div>
                      <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-400 border-2 border-white rounded-full" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-bold text-gray-900">{c.name}</span>
                          {c.isNew && (
                            <span className="text-[10px] bg-orange-500 text-white px-1.5 py-0.5 rounded-full font-bold">NEW</span>
                          )}
                        </div>
                        <span className="text-[10px] text-gray-400 flex-shrink-0">
                          {last ? relTime(last.ts) : relTime(c.joinedAt)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-1">
                        <p className="text-xs text-gray-500 truncate flex-1">
                          {last
                            ? (last.isAdmin ? `나: ${last.text}` : last.text)
                            : '새 고객 입장'}
                        </p>
                        {c.unread > 0 && (
                          <span className="flex-shrink-0 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                            {c.unread > 9 ? '9+' : c.unread}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          <div className="border-t border-gray-100 px-4 py-2.5 flex-shrink-0 bg-gray-50">
            <div className="flex justify-around text-center">
              <div>
                <div className="text-base font-black text-gray-900">{customers.length}</div>
                <div className="text-[10px] text-gray-400">전체</div>
              </div>
              <div>
                <div className="text-base font-black text-green-500">{customers.length}</div>
                <div className="text-[10px] text-gray-400">온라인</div>
              </div>
              <div>
                <div className="text-base font-black text-red-500">{totalUnread}</div>
                <div className="text-[10px] text-gray-400">미답변</div>
              </div>
            </div>
          </div>
        </aside>

        {/* ════════════════ RIGHT: Chat Panel ════════════════ */}
        {selectedCustomer ? (
          <div className="flex-1 flex flex-col overflow-hidden">

            <div className="bg-white border-b border-gray-200 px-6 py-3 flex-shrink-0 flex items-center justify-between shadow-sm">
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-white font-extrabold text-sm shadow"
                  style={{ backgroundColor: selectedCustomer.color }}
                >
                  {selectedCustomer.name.replace('익명_', '')}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-gray-900">{selectedCustomer.name}</span>
                    <span className="flex items-center gap-1 text-xs text-green-500 font-semibold">
                      <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />온라인
                    </span>
                  </div>
                  <p className="text-xs text-gray-400">
                    입장 {relTime(selectedCustomer.joinedAt)} &nbsp;·&nbsp; 메시지 {selectedMessages.length}개
                  </p>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-gray-400">고객 문의</div>
                <div className="text-sm font-black text-orange-500">
                  {selectedMessages.filter(m => !m.isAdmin).length}건
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-1 bg-gray-50 no-scrollbar">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex-1 border-t border-gray-200" />
                <span className="text-[11px] text-gray-400 whitespace-nowrap">
                  {selectedCustomer.name} 입장 · {relTime(selectedCustomer.joinedAt)}
                </span>
                <div className="flex-1 border-t border-gray-200" />
              </div>

              {selectedMessages.map((msg, i) => {
                const prev = i > 0 ? selectedMessages[i - 1] : null
                const showSep = !prev || new Date(msg.ts).getTime() - new Date(prev.ts).getTime() > 5 * 60000
                const sameAsPrev = prev && prev.isAdmin === msg.isAdmin && !showSep

                return (
                  <div key={msg.id}>
                    {showSep && (
                      <div className="flex items-center gap-3 my-3">
                        <div className="flex-1 border-t border-gray-200" />
                        <span className="text-[10px] text-gray-400">{clockTime(msg.ts)}</span>
                        <div className="flex-1 border-t border-gray-200" />
                      </div>
                    )}

                    <div className={`flex ${msg.isAdmin ? 'justify-end' : 'justify-start'} ${sameAsPrev ? 'mt-0.5' : 'mt-2'}`}>
                      {!msg.isAdmin && !sameAsPrev ? (
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mr-2 mt-1 shadow-sm"
                          style={{ backgroundColor: selectedCustomer.color }}
                        >
                          {selectedCustomer.name.replace('익명_', '')}
                        </div>
                      ) : !msg.isAdmin ? (
                        <div className="w-7 mr-2 flex-shrink-0" />
                      ) : null}

                      <div className={`max-w-[65%] flex flex-col ${msg.isAdmin ? 'items-end' : 'items-start'}`}>
                        {!msg.isAdmin && !sameAsPrev && (
                          <p className="text-[11px] text-gray-400 mb-1 ml-1">{selectedCustomer.name}</p>
                        )}
                        <div
                          className={`px-4 py-2.5 text-sm leading-relaxed break-words rounded-2xl ${
                            msg.isAdmin
                              ? 'text-white rounded-tr-sm shadow-md'
                              : 'bg-white text-gray-800 rounded-tl-sm shadow-sm border border-gray-100'
                          }`}
                          style={msg.isAdmin ? { background: 'linear-gradient(135deg,#ff6a00,#e53935)' } : {}}
                        >
                          {msg.text}
                        </div>
                        {msg.isAdmin && (
                          <p className="text-[10px] text-gray-400 mt-0.5 mr-1">{clockTime(msg.ts)} · 전송됨</p>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
              <div ref={chatEndRef} />
            </div>

            <div className="bg-white border-t border-gray-200 px-5 py-3 flex-shrink-0">
              <div className="flex flex-wrap gap-1.5 mb-2.5">
                {QUICK_REPLIES.map(r => (
                  <button
                    key={r}
                    onClick={() => { setInputText(r); inputRef.current?.focus() }}
                    className="text-[11px] bg-orange-50 text-orange-600 border border-orange-200 px-2.5 py-1 rounded-full hover:bg-orange-100 active:scale-95 transition-all"
                  >
                    {r}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-3">
                <div className={`flex-1 flex items-center gap-2 bg-gray-100 rounded-2xl px-4 py-2.5 transition-all ${inputText ? 'ring-2 ring-orange-300 border border-orange-300' : 'border border-gray-200'}`}>
                  <input
                    ref={inputRef}
                    type="text"
                    value={inputText}
                    onChange={e => setInputText(e.target.value)}
                    onKeyDown={handleKey}
                    placeholder={`${selectedCustomer.name}에게 메시지 전송...`}
                    className="flex-1 bg-transparent text-sm text-gray-800 placeholder-gray-400 outline-none"
                  />
                  {inputText && (
                    <button onClick={() => setInputText('')} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
                  )}
                </div>
                <button
                  onClick={sendMessage}
                  disabled={!inputText.trim()}
                  className="w-11 h-11 rounded-2xl flex items-center justify-center text-white text-lg font-black shadow-md transition-all active:scale-90 disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                  style={{ background: inputText.trim() ? 'linear-gradient(135deg,#ff6a00,#e53935)' : '#d1d5db' }}
                >
                  ↑
                </button>
              </div>
              <p className="text-[10px] text-gray-400 mt-2 text-center">
                Enter로 전송 &nbsp;·&nbsp; 위 빠른답변 클릭 후 수정 가능
              </p>
            </div>
          </div>

        ) : (
          <div className="flex-1 flex items-center justify-center bg-gray-50">
            <div className="text-center">
              <div className="text-6xl mb-4">💬</div>
              <h3 className="text-lg font-bold text-gray-700 mb-2">채팅을 선택하세요</h3>
              <p className="text-sm text-gray-400">
                왼쪽 목록에서 고객을 클릭하면<br />1:1 상담 채팅창이 열립니다.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
