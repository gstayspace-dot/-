import { createClient } from '@supabase/supabase-js'
import type { Product } from './types'

// ── Supabase DB row types (snake_case) ────────────────────────────────────────

export type DbProduct = {
  id: string
  name: string
  image_url: string
  original_price: number
  live_price: number
  quantity: number
  specs: string
  is_live: boolean
  created_at: string
  sort_order: number | null
}

export type DbChatCustomer = {
  id: string
  name: string
  joined_at: string
  deleted_at?: string | null
}

export type DbChatMessage = {
  id: string
  customer_id: string
  text: string
  is_admin: boolean
  created_at: string
}

export type DbOrder = {
  id: string
  created_at: string
  customer_name: string
  customer_phone: string
  customer_address: string
  customer_request: string
  total_price: number
  status: string
  deleted_at?: string | null
}

export type DbOrderItem = {
  id: string
  order_id: string
  product_id: string
  product_name: string
  quantity: number
  price: number
}

// ── Singleton client ──────────────────────────────────────────────────────────
// Fallback placeholders prevent build-time crashes when env vars are absent
// (e.g. Google Cloud Build without Secret Manager injection).
// At runtime the real values must be supplied via environment variables.

const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL  || 'https://placeholder.supabase.co'
const supabaseKey  = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'

export const supabase = createClient(supabaseUrl, supabaseKey)

// ── Mapping helpers ───────────────────────────────────────────────────────────

export function rowToProduct(row: DbProduct): Product & { isLive: boolean } {
  return {
    id: row.id,
    name: row.name,
    imageUrl: row.image_url,
    originalPrice: row.original_price,
    livePrice: row.live_price,
    quantity: row.quantity,
    specs: row.specs,
    createdAt: row.created_at,
    isLive: row.is_live,
    sortOrder: row.sort_order,
  }
}

// 노출 순서 정렬 비교자: sort_order 오름차순(미지정은 뒤로), 동률이면 최신 등록순
export function compareProducts(a: Product, b: Product): number {
  const ax = a.sortOrder ?? Number.POSITIVE_INFINITY
  const bx = b.sortOrder ?? Number.POSITIVE_INFINITY
  if (ax !== bx) return ax - bx
  return b.createdAt.localeCompare(a.createdAt)
}

export function productBodyToRow(body: Record<string, unknown>) {
  return {
    name:           String(body.name ?? ''),
    image_url:      String(body.imageUrl ?? ''),
    original_price: Number(body.originalPrice) || 0,
    live_price:     Number(body.livePrice) || 0,
    quantity:       Number(body.quantity) || 0,
    specs:          String(body.specs ?? ''),
  }
}
