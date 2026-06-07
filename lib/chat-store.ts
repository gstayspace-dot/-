/**
 * Client-side session management only.
 * Chat data is now persisted in Supabase (chat_customers / chat_messages tables).
 */

export type ChatCustomer = {
  id: string
  name: string
  joinedAt: string
}

export type ChatMessage = {
  id: string
  customerId: string
  text: string
  isAdmin: boolean
  ts: string
}

const SS_SESSION = 'tlc_session'

export function getOrCreateSession(): ChatCustomer {
  if (typeof window === 'undefined') throw new Error('Client only')
  const raw = sessionStorage.getItem(SS_SESSION)
  if (raw) {
    try { return JSON.parse(raw) as ChatCustomer } catch {}
  }
  const session: ChatCustomer = {
    id: `cust_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: `익명_${Math.floor(Math.random() * 9000) + 1000}`,
    joinedAt: new Date().toISOString(),
  }
  sessionStorage.setItem(SS_SESSION, JSON.stringify(session))
  return session
}
