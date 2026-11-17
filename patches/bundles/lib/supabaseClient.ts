import type { ShippingGroup } from './shipping-quote'
import { createClient } from '@supabase/supabase-js'
import type { Product } from './types'

// ── Supabase DB row types (snake_case) ────────────────────────────────────────

export type DbProduct = {
  supplier_id?: string | null
  id: string
  name: string
  image_url?: string | null
  original_price: number
  live_price: number
  quantity: number
  specs?: string | null
  description?: string | null
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
  payment_key?: string | null
  payment_amount?: number | null
  payment_method?: string | null
  payment_confirmed_at?: string | null
  deleted_at?: string | null
  shipping_breakdown?: ShippingGroup[] | null
}

export type DbOrderItem = {
  id: string
  order_id: string
  product_id: string
  product_name: string
  supplier_id?: string | null
  supplier_name?: string | null
  quantity: number
  price: number
}

export const PRODUCT_PUBLIC_SELECT =
  'id,supplier_id,name,image_url,original_price,live_price,quantity,specs,is_live,created_at,sort_order'
export const PRODUCT_PUBLIC_LIST_SELECT =
  'id,supplier_id,name,image_url,original_price,live_price,quantity,is_live,created_at,sort_order'
export const PRODUCT_LIST_SELECT =
  'id,supplier_id,name,image_url,original_price,live_price,quantity,is_live,created_at,sort_order'
export const PRODUCT_ADMIN_LIST_SELECT =
  'id,supplier_id,name,original_price,live_price,quantity,is_live,created_at,sort_order'
export const BRAND_REGISTRY_PRODUCT_ID = '00000000-0000-0000-0000-000000000001'
export const BRAND_REGISTRY_PRODUCT_NAME = '__BRAND_REGISTRY__'
export const CATEGORY_REGISTRY_PRODUCT_ID = '00000000-0000-0000-0000-000000000002'
export const CATEGORY_REGISTRY_PRODUCT_NAME = '__CATEGORY_REGISTRY__'
export const PRODUCT_META_REGISTRY_PRODUCT_ID = '00000000-0000-0000-0000-000000000003'
export const PRODUCT_META_REGISTRY_PRODUCT_NAME = '__PRODUCT_META_REGISTRY__'
export const PRODUCT_META_REGISTRY_PREFIX = '[[PRODUCT_META_REGISTRY]]\n'

export type ProductMetaEntry = {
  purchaseConfig?: import('./purchase-config').PurchaseConfig
  brand: string
  category: string
  isVisible: boolean
  isBest?: boolean
}

export type ProductMetaRegistry = Record<string, ProductMetaEntry>

const DESCRIPTION_MARKER = '\n\n[[PRODUCT_DESCRIPTION]]\n'
const CATEGORY_MARKER = '\n\n[[PRODUCT_CATEGORY]]\n'
const BRAND_MARKER = '\n\n[[PRODUCT_BRAND]]\n'
const BEST_MARKER = '\n\n[[PRODUCT_BEST]]\n'
const VISIBILITY_MARKER = '\n\n[[PRODUCT_VISIBLE]]\n'
export function splitSpecsAndDescription(value: string) {
  const bestIndex = value.indexOf(BEST_MARKER)
  const descriptionIndex = value.indexOf(DESCRIPTION_MARKER)
  const categoryIndex = value.indexOf(CATEGORY_MARKER)
  const brandIndex = value.indexOf(BRAND_MARKER)
  const visibilityIndex = value.indexOf(VISIBILITY_MARKER)
  const markerIndexes = [descriptionIndex, categoryIndex, brandIndex, visibilityIndex, bestIndex].filter(index => index >= 0)
  if (markerIndexes.length === 0) return { specs: value, category: '', brand: '', isVisible: true, isBest: false, description: '' }
  const specsEnd = Math.min(...markerIndexes)
  const markerAfter = (index: number) => Math.min(
    ...markerIndexes.filter(markerIndex => markerIndex > index),
    value.length,
  )
  return {
    specs: value.slice(0, specsEnd),
    isBest: bestIndex >= 0 && value.slice(bestIndex + BEST_MARKER.length, markerAfter(bestIndex)).trim() === 'true',
    category: categoryIndex >= 0 ? value.slice(categoryIndex + CATEGORY_MARKER.length, markerAfter(categoryIndex)).trim() : '',
    brand: brandIndex >= 0 ? value.slice(brandIndex + BRAND_MARKER.length, markerAfter(brandIndex)).trim() : '',
    isVisible: visibilityIndex >= 0 ? value.slice(visibilityIndex + VISIBILITY_MARKER.length, markerAfter(visibilityIndex)).trim() !== 'false' : true,
    description: descriptionIndex >= 0 ? value.slice(descriptionIndex + DESCRIPTION_MARKER.length) : '',
  }
}

export function parseProductMeta(specs: string | null | undefined) {
  const parsed = splitSpecsAndDescription(specs ?? '')
  return { brand: parsed.brand, category: parsed.category, isVisible: parsed.isVisible, isBest: parsed.isBest }
}

export function normalizeProductMetaEntry(value: Partial<ProductMetaEntry> | Record<string, unknown>): ProductMetaEntry {
  return {
    ...(value.purchaseConfig && typeof value.purchaseConfig === 'object' ? { purchaseConfig: value.purchaseConfig as import('./purchase-config').PurchaseConfig } : {}),
    brand: typeof value.brand === 'string' ? value.brand.trim() : '',
    category: typeof value.category === 'string' ? value.category.trim() : '',
    isVisible: value.isVisible !== false,
    isBest: value.isBest === true,
  }
}

export function hasMeaningfulProductMeta(entry: ProductMetaEntry) {
  return Boolean(entry.brand || entry.category || entry.isVisible === false || entry.isBest || entry.purchaseConfig)
}

export function parseProductMetaRegistry(specs: string | null | undefined): ProductMetaRegistry {
  if (!specs?.startsWith(PRODUCT_META_REGISTRY_PREFIX)) return {}
  try {
    const parsed = JSON.parse(specs.slice(PRODUCT_META_REGISTRY_PREFIX.length))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const registry: ProductMetaRegistry = {}
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof id !== 'string' || !value || typeof value !== 'object' || Array.isArray(value)) continue
      const entry = normalizeProductMetaEntry(value as Record<string, unknown>)
      if (hasMeaningfulProductMeta(entry)) registry[id] = entry
    }
    return registry
  } catch {
    return {}
  }
}

export function serializeProductMetaRegistry(registry: ProductMetaRegistry) {
  const compactEntries = Object.entries(registry)
    .map(([id, entry]) => [id, normalizeProductMetaEntry(entry)] as const)
    .filter(([, entry]) => hasMeaningfulProductMeta(entry))
    .sort(([a], [b]) => a.localeCompare(b))
  return `${PRODUCT_META_REGISTRY_PREFIX}${JSON.stringify(Object.fromEntries(compactEntries))}`
}

export async function readProductMetaRegistry() {
  const { data, error } = await supabase
    .from('products')
    .select('specs')
    .eq('id', PRODUCT_META_REGISTRY_PRODUCT_ID)
    .maybeSingle()
  if (error) throw new Error('상품 분류를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.')

  return parseProductMetaRegistry((data as { specs?: string | null } | null)?.specs)
}

export async function saveProductMetaRegistry(registry: ProductMetaRegistry) {
  const { error } = await supabase.from('products').upsert({
    id: PRODUCT_META_REGISTRY_PRODUCT_ID,
    name: PRODUCT_META_REGISTRY_PRODUCT_NAME,
    image_url: '',
    original_price: 0,
    live_price: 0,
    quantity: 0,
    specs: serializeProductMetaRegistry(registry),
    is_live: false,
    sort_order: 999997,
  })

  return error
}

// Optimistic locking on the registry's otherwise unused sort order prevents
// simultaneous product saves from replacing another product's classification.
async function mutateProductMetaRegistry(productId: string, meta: ProductMetaEntry | null, expectedConfig?: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: current, error: readError } = await supabase.from('products')
      .select('specs,sort_order').eq('id', PRODUCT_META_REGISTRY_PRODUCT_ID).maybeSingle()
    if (readError) return readError
    const registry = parseProductMetaRegistry(current?.specs)
    if (expectedConfig !== undefined && JSON.stringify(registry[productId]?.purchaseConfig ?? { variants: [], addons: [] }) !== expectedConfig) return { message: '상품 구성이 변경되었습니다. 다시 불러와주세요.' }
    if (expectedConfig !== undefined && meta?.purchaseConfig) {
      // Components may be reused across representative products.
      meta = { ...normalizeProductMetaEntry(registry[productId] ?? {}), purchaseConfig: meta.purchaseConfig }
    }
    if (meta && expectedConfig === undefined && registry[productId]?.purchaseConfig) meta = { ...meta, purchaseConfig: registry[productId].purchaseConfig }
    if (meta && hasMeaningfulProductMeta(meta)) registry[productId] = meta
    else delete registry[productId]
    if (!current) {
      const { error } = await supabase.from('products').insert({
        id: PRODUCT_META_REGISTRY_PRODUCT_ID, name: PRODUCT_META_REGISTRY_PRODUCT_NAME,
        image_url: '', original_price: 0, live_price: 0, quantity: 0,
        specs: serializeProductMetaRegistry(registry), is_live: false, sort_order: 999997,
      })
      if (!error) return null
      if (error.code !== '23505') return error
      continue
    }
    const version = current.sort_order
    let query = supabase.from('products').update({
      specs: serializeProductMetaRegistry(registry), sort_order: (version ?? 999997) + 1,
    }).eq('id', PRODUCT_META_REGISTRY_PRODUCT_ID)
    query = version == null ? query.is('sort_order', null) : query.eq('sort_order', version)
    const { data: saved, error } = await query.select('id')
    if (error) return error
    if (saved?.length) return null
  }
  return { message: '동시에 다른 상품을 저장 중입니다. 분류 저장을 다시 시도해주세요.' }
}

export async function updateProductMetaRegistryEntry(productId: string, meta: Partial<ProductMetaEntry> | Record<string, unknown>) {
  if ([BRAND_REGISTRY_PRODUCT_ID, CATEGORY_REGISTRY_PRODUCT_ID, PRODUCT_META_REGISTRY_PRODUCT_ID].includes(productId)) return null
  return mutateProductMetaRegistry(productId, normalizeProductMetaEntry(meta))
}

export async function savePurchaseConfig(productId: string, config: import('./purchase-config').PurchaseConfig, expectedConfig: string) {
  const registry = await readProductMetaRegistry()
  return mutateProductMetaRegistry(productId, { ...normalizeProductMetaEntry(registry[productId] ?? {}), purchaseConfig: config }, expectedConfig)
}

export async function removeProductMetaRegistryEntry(productId: string) {
  return mutateProductMetaRegistry(productId, null)
}

// ── Singleton client ──────────────────────────────────────────────────────────
// NEXT_PUBLIC values are embedded into browser bundles during `next build`.
// Cloud Run's runtime environment is not available to a Dockerfile build, so
// keep the project's public URL and publishable anon key as safe build fallbacks.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://iuqettindwhdhrxdfpip.supabase.co'
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_gV0AiwezNsTcAGHXqIxwPg_7oKW_lQb'

export const supabase = createClient(supabaseUrl, supabaseKey, {
  global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
})

export const PRODUCT_SORT_ORDER_STEP = 1000

const ORDER_ITEM_PAGE_SIZE = 1000
const ORDER_ITEM_ID_CHUNK_SIZE = 80

export async function fetchOrderItemsForOrders(orderIds: string[]) {
  const ids = Array.from(new Set(orderIds.filter(Boolean)))
  if (ids.length === 0) return { data: [] as DbOrderItem[], error: null }

  const rows: DbOrderItem[] = []

  async function fetchChunk(chunkStart: number) {
    const chunkRows: DbOrderItem[] = []
    const chunk = ids.slice(chunkStart, chunkStart + ORDER_ITEM_ID_CHUNK_SIZE)

    for (let start = 0; ; start += ORDER_ITEM_PAGE_SIZE) {
      const page = await supabase
        .from('order_items')
        .select('*')
        .in('order_id', chunk)
        .order('id', { ascending: true })
        .range(start, start + ORDER_ITEM_PAGE_SIZE - 1)

      if (page.error) return { data: null, error: page.error }

      const pageRows = (page.data ?? []) as DbOrderItem[]
      chunkRows.push(...pageRows)

      if (pageRows.length < ORDER_ITEM_PAGE_SIZE) break
    }
    return { data: chunkRows, error: null }
  }

  // Limit concurrent requests while avoiding one round trip per chunk in series.
  for (let batch = 0; batch < ids.length; batch += ORDER_ITEM_ID_CHUNK_SIZE * 4) {
    const starts = [0, 1, 2, 3].map(i => batch + i * ORDER_ITEM_ID_CHUNK_SIZE).filter(start => start < ids.length)
    const pages = await Promise.all(starts.map(fetchChunk))
    for (const page of pages) {
      if (page.error) return { data: null, error: page.error }
      rows.push(...(page.data ?? []))
    }
  }

  return { data: rows, error: null }
}

// ── Mapping helpers ───────────────────────────────────────────────────────────

export function rowToProduct(row: DbProduct): Product & { isLive: boolean } {
  const parsed = splitSpecsAndDescription(row.specs ?? '')
  const description = row.description ?? parsed.description
  return {
    id: row.id,
    supplierId: row.supplier_id ?? null,
    name: row.name,
    brand: parsed.brand,
    category: parsed.category,
    isVisible: parsed.isVisible,
    isBest: parsed.isBest,
    imageUrl: row.image_url ?? '',
    originalPrice: row.original_price,
    livePrice: row.live_price,
    quantity: row.quantity,
    specs: parsed.specs,
    description,
    createdAt: row.created_at,
    isLive: row.is_live,
    sortOrder: row.sort_order,
    ...(row.supplier_id !== undefined ? { supplierId: row.supplier_id } : {}),
  }
}

function stripEmbeddedDescription(value: string) {
  const descriptionIndex = value.indexOf(DESCRIPTION_MARKER)
  return descriptionIndex >= 0 ? value.slice(0, descriptionIndex) : value
}

export function rowToProductSummary(row: DbProduct): Product & { isLive: boolean } {
  const parsed = splitSpecsAndDescription(stripEmbeddedDescription(row.specs ?? ''))
  return {
    id: row.id,
    supplierId: row.supplier_id ?? null,
    name: row.name,
    brand: parsed.brand,
    category: parsed.category,
    isVisible: parsed.isVisible,
    isBest: parsed.isBest,
    imageUrl: row.image_url ?? '',
    originalPrice: row.original_price,
    livePrice: row.live_price,
    quantity: row.quantity,
    specs: parsed.specs,
    description: '',
    createdAt: row.created_at,
    isLive: row.is_live,
    sortOrder: row.sort_order,
    ...(row.supplier_id !== undefined ? { supplierId: row.supplier_id } : {}),
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
  const imageUrl = String(body.imageUrl ?? '').trim()
  const specs = String(body.specs ?? '')
  const category = String(body.category ?? '').trim()
  const brand = String(body.brand ?? '').trim()
  const description = String(body.description ?? '').trim()
  const visibility = body.isVisible === false ? 'false' : 'true'
  const specsWithBrand = brand ? `${specs}${BRAND_MARKER}${brand}` : specs
  const specsWithCategory = category ? `${specsWithBrand}${CATEGORY_MARKER}${category}` : specsWithBrand
  const specsWithVisibility = `${specsWithCategory}${VISIBILITY_MARKER}${visibility}${BEST_MARKER}${body.isBest === true ? 'true' : 'false'}`

  return {
    ...(Object.prototype.hasOwnProperty.call(body, 'supplierId') ? { supplier_id: body.supplierId || null } : {}),
    name:           String(body.name ?? ''),
    image_url:      imageUrl,
    original_price: Number(body.originalPrice) || 0,
    live_price:     Number(body.livePrice) || 0,
    quantity:       Number(body.quantity) || 0,
    specs:          description ? `${specsWithVisibility}${DESCRIPTION_MARKER}${description}` : specsWithVisibility,
    is_live:        Boolean(body.isLive),
  }
}

export function toPublicProduct(product: Product & { isLive: boolean }) {
  return {
    ...product,
    imageUrl: product.imageUrl
      ? product.imageUrl.startsWith('/api/products/')
        ? product.imageUrl
        : `/api/products/${product.id}/image`
      : '',
  }
}

export function toAdminListProduct(product: Product & { isLive: boolean }) {
  return {
    ...product,
    description: '',
    imageUrl: `/api/products/${product.id}/image`,
  }
}
