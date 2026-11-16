import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { receiptAdmin } from './receipt-admin-auth'
import { readBody } from './marketing/server'
import { sameOrigin as requireAdminOrigin } from './server/auth'
import { parseProductMetaRegistry, rowToProduct, BRAND_REGISTRY_PRODUCT_ID, CATEGORY_REGISTRY_PRODUCT_ID, PRODUCT_META_REGISTRY_PRODUCT_ID, type DbProduct } from './supabaseClient'
import { priceError, type LiveProduct, type LiveCurrent } from './live-overlay'

const reserved = [BRAND_REGISTRY_PRODUCT_ID, CATEGORY_REGISTRY_PRODUCT_ID, PRODUCT_META_REGISTRY_PRODUCT_ID]
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const columns = 'id,name,original_price,live_price,quantity,specs,is_live,created_at,sort_order'
export function liveDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (process.env.LIVE_OVERLAY_ENABLED !== 'true' || !url || !key) throw new Error('방송 연동 설정을 확인해주세요.')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store', signal: AbortSignal.timeout(3000) }) } })
}
type Db = ReturnType<typeof liveDb>
export function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' } })
}
export async function authorized(request: NextRequest) { return (await receiptAdmin(request)) }
async function registry(db: Db) {
  const { data, error } = await db.from('products').select('specs').eq('id', PRODUCT_META_REGISTRY_PRODUCT_ID).maybeSingle()
  if (error) throw new Error('상품 노출 정보를 읽지 못했습니다.')
  return parseProductMetaRegistry(data?.specs)
}
function mapProduct(row: DbProduct, meta: Awaited<ReturnType<typeof registry>>, image = false): LiveProduct {
  const p = { ...rowToProduct(row), ...(meta[row.id] ?? {}) }
  const error = !p.isVisible ? '비노출 상품' : !(p.quantity > 0) ? '품절 상품' : !p.name.trim() ? '상품명 누락' : priceError(p.originalPrice, p.livePrice)
  // The existing same-origin image endpoint handles stored base64 and remote images.
  // A content hash prevents OBS reusing an older image after a product image edit.
  const version = image ? `?v=${createHash('sha256').update(row.image_url ?? '').digest('hex').slice(0, 16)}` : ''
  return { id: p.id, name: p.name, image_url: image && !row.image_url ? '' : `/api/products/${p.id}/image${version}`, original_price: p.originalPrice, sale_price: p.livePrice,
    discount_amount: error ? 0 : p.originalPrice - p.livePrice, discount_percent: error ? 0 : Math.round((p.originalPrice - p.livePrice) / p.originalPrice * 100), error }
}
async function product(db: Db, id: string) {
  if (!uuid.test(id) || reserved.includes(id)) return null
  const [{ data, error }, meta] = await Promise.all([db.from('products').select(`${columns},image_url`).eq('id', id).maybeSingle(), registry(db)])
  if (error) throw new Error('상품 조회 실패')
  return data ? mapProduct(data as DbProduct, meta, true) : null
}
async function state(db: Db) {
  const { data, error } = await db.from('live_overlay_state').select('product_id,visible,revision').eq('id', 1).single()
  if (error || !data) throw new Error('방송 상태 저장소를 확인해주세요.')
  return data as { product_id: string | null; visible: boolean; revision: number }
}
export async function current(db: Db): Promise<LiveCurrent> {
  const saved = await state(db)
  if (!saved.visible) return { visible: false, product: null, revision: saved.revision, error: null }
  const p = saved.product_id ? await product(db, saved.product_id) : null
  const error = p?.error ?? (!p ? '삭제되었거나 사용할 수 없는 상품' : null)
  return { visible: !error, product: error ? null : p, revision: saved.revision, error }
}
export async function getCurrent() {
  try { return reply(await current(liveDb())) } catch { return reply({ visible: false, product: null, error: '방송 연결 실패', revision: null }, 503) }
}
export async function getProducts(request: NextRequest) {
  if (!(await authorized(request))) return reply({ error: '관리자 재로그인이 필요합니다.' }, 401)
  try {
    const db = liveDb(), params = request.nextUrl.searchParams
    const rawOffset = Number(params.get('offset') ?? 0)
    const offset = Number.isSafeInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0
    const search = (params.get('q') ?? '').trim().slice(0, 100).replace(/[\\%_]/g, '\\$&')
    let query = db.from('products').select(columns, { count: 'exact' })
    for (const id of reserved) query = query.neq('id', id)
    if (search) query = query.ilike('name', `%${search}%`)
    const [{ data, error, count }, meta] = await Promise.all([query.order('sort_order', { ascending: true, nullsFirst: false }).order('id').range(offset, offset + 29), registry(db)])
    if (error) throw error
    return reply({ items: (data ?? []).map(row => mapProduct(row as DbProduct, meta)), total: count ?? 0, offset, next_offset: offset + 30, has_more: offset + 30 < (count ?? 0) })
  } catch { return reply({ items: [], error: '상품 목록을 불러오지 못했습니다.' }, 503) }
}
export async function setCurrent(request: NextRequest) {
  if (!(await authorized(request))) return reply({ error: '관리자 재로그인이 필요합니다.' }, 401)
  try {
    // Broadcast writes use the same owned origins as administrator login.
    // Keep an explicit Origin mandatory for this browser-only control.
    if (!request.headers.get('origin')) throw new Error('Origin required')
    requireAdminOrigin(request)
  } catch { return reply({ error: '허용되지 않은 요청입니다.' }, 403) }
  let body
  try { body = await readBody(request) } catch { return reply({ error: '요청 형식 오류' }, 400) }
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.visible !== 'boolean' || !Number.isSafeInteger(body.revision) || body.revision < 0 || Object.keys(body).some(key => !['visible','product_id','revision'].includes(key)) || (body.visible && (typeof body.product_id !== 'string' || !uuid.test(body.product_id)))) return reply({ error: '상품과 방송 상태를 확인해주세요.' }, 400)
  try {
    const db = liveDb()
    if (body.visible) {
      const p = await product(db, body.product_id)
      if (!p || p.error) return reply({ error: p?.error ?? '상품을 찾을 수 없습니다.' }, 422)
    }
    // Compare-and-swap rejects stale clicks from another tab instead of silently
    // replacing a newer choice. Prices never enter this state row.
    const { data, error } = await db.from('live_overlay_state').update({ visible: body.visible, product_id: body.visible ? body.product_id : null, revision: body.revision + 1, updated_at: new Date().toISOString() }).eq('id', 1).eq('revision', body.revision).select('revision').maybeSingle()
    if (error) throw error
    if (!data) return reply({ error: '다른 창에서 상태가 변경되었습니다. 확인 후 다시 선택해주세요.' }, 409)
    return reply(await current(db))
  } catch { return reply({ error: '방송 상태를 확인할 수 없습니다. 현재 상태를 다시 조회해주세요.' }, 503) }
}
