import { purchaseGroups } from '@/lib/purchase-config-server'
import { validateSupplierSelection } from '@/lib/supplier-selection'
import { productValidationError, productMeta, PRODUCT_META_WARNING } from '@/lib/product-validation'
import { NextResponse } from 'next/server'
import { BRAND_REGISTRY_PRODUCT_ID, CATEGORY_REGISTRY_PRODUCT_ID, PRODUCT_ADMIN_LIST_SELECT, PRODUCT_META_REGISTRY_PRODUCT_ID, PRODUCT_PUBLIC_LIST_SELECT, PRODUCT_PUBLIC_SELECT, PRODUCT_SORT_ORDER_STEP, productBodyToRow, readProductMetaRegistry, rowToProduct, rowToProductSummary, supabase, toAdminListProduct, toPublicProduct, updateProductMetaRegistryEntry, type DbProduct } from '@/lib/supabaseClient'
import { fallbackProducts } from '@/lib/fallbackProducts'

export const dynamic = 'force-dynamic'

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams
  const includeHidden = searchParams.get('includeHidden') === 'true'
  const includeDetails = searchParams.get('includeDetails') === 'true'
  const listOnly = searchParams.get('listOnly') === 'true'
  const group = searchParams.get('group') === 'live'
    ? 'live'
    : searchParams.get('group') === 'general'
      ? 'general'
      : null
  const limitText = searchParams.get('limit')
  const offsetText = searchParams.get('offset')
  const limitParam = limitText === null ? Number.NaN : Number(limitText)
  const offsetParam = offsetText === null ? Number.NaN : Number(offsetText)
  const hasPagination = searchParams.get('paged') === 'true' || limitText !== null || offsetText !== null
  const limit = Number.isInteger(limitParam) ? Math.max(1, Math.min(limitParam, 100)) : 30
  const offset = Number.isInteger(offsetParam) ? Math.max(0, offsetParam) : 0
  const usesLightList = !includeDetails && (includeHidden || listOnly || hasPagination)
  const selectColumns = includeDetails
    ? PRODUCT_PUBLIC_SELECT
    : includeHidden
      ? PRODUCT_ADMIN_LIST_SELECT
      : usesLightList
        ? PRODUCT_PUBLIC_LIST_SELECT
        : PRODUCT_PUBLIC_SELECT
  function buildQuery() {
    let query = hasPagination
      ? supabase.from('products').select(selectColumns as '*', { count: 'exact' })
      : supabase.from('products').select(selectColumns as '*')

    query = query
      .neq('id', BRAND_REGISTRY_PRODUCT_ID)
      .neq('id', CATEGORY_REGISTRY_PRODUCT_ID)
      .neq('id', PRODUCT_META_REGISTRY_PRODUCT_ID)
    if (group === 'live') query = query.eq('is_live', true)
    if (group === 'general') query = query.eq('is_live', false)
    query = query
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })
    if (hasPagination) query = query.range(offset, offset + limit - 1)
    return query
  }

  let { data, error, count } = await buildQuery()
  if (error && hasPagination && error.message !== 'Requested range not satisfiable') {
    await wait(350)
    ;({ data, error, count } = await buildQuery())
  }

  if (error) {
    if (hasPagination && error.message === 'Requested range not satisfiable') {
      let countQuery = supabase
        .from('products')
        .select('id', { count: 'exact', head: true })
        .neq('id', BRAND_REGISTRY_PRODUCT_ID)
        .neq('id', CATEGORY_REGISTRY_PRODUCT_ID)
        .neq('id', PRODUCT_META_REGISTRY_PRODUCT_ID)
      if (group === 'live') countQuery = countQuery.eq('is_live', true)
      if (group === 'general') countQuery = countQuery.eq('is_live', false)

      const { count: safeCount } = await countQuery
      const total = safeCount ?? 0
      return NextResponse.json({
        products: [],
        total,
        limit,
        offset,
        nextOffset: Math.min(offset, total),
        hasMore: false,
        group: group ?? 'all',
      })
    }
    if (hasPagination) return NextResponse.json({ error: error.message, products: [], total: 0, limit, offset, nextOffset: offset, hasMore: false, group: group ?? 'all' }, { status: 500 })
    return NextResponse.json(fallbackProducts)
  }
  const rows = (data ?? []) as unknown as DbProduct[]
  const metaRegistry = await readProductMetaRegistry()
  const { groups, members } = includeHidden ? { groups: [], members: new Set<string>() } : await purchaseGroups()
  const variantIds = Array.from(new Set(groups.flatMap(g => g.variants.map(c => c.productId))))
  const variantStock = variantIds.length ? await supabase.from('products').select('id,quantity').in('id', variantIds) : { data: [], error: null }
  if (variantStock.error) return NextResponse.json({ error: '옵션 재고 조회에 실패했습니다.' }, { status: 503 })
  const products = rows
    .map(row => includeDetails || !usesLightList ? rowToProduct(row) : rowToProductSummary(row))
    .map(product => ({ ...product, ...(metaRegistry[product.id] ?? {}) }))
    .map(product => includeHidden && !includeDetails ? toAdminListProduct(product) : toPublicProduct(product))
    .filter(product => includeHidden || (product.isVisible && !members.has(product.id))).map(product => { const group = groups.find(g => g.id === product.id); return { ...product, name: group?.title || product.name, purchaseConfig: group ?? product.purchaseConfig, quantity: includeHidden ? product.quantity : group?.variants.length ? group.variants.reduce((sum,c) => sum + (metaRegistry[c.productId]?.isSoldOut || metaRegistry[c.productId]?.isVisible === false ? 0 : variantStock.data?.find(p => p.id === c.productId)?.quantity ?? 0),0) : product.isSoldOut ? 0 : product.quantity } })
  const total = typeof count === 'number' ? count : offset + rows.length
  const nextOffset = offset + limit
  const hasMore = typeof count === 'number' ? nextOffset < count : rows.length === limit

  const response = NextResponse.json(
    hasPagination
      ? { products, total, limit, offset, nextOffset, hasMore, group: group ?? 'all' }
      : products.length > 0 || group ? products : fallbackProducts,
  )
  response.headers.set('X-Product-Image-Mode', 'lazy-v1')
  response.headers.set('Cache-Control', 'no-store, max-age=0')
  if (includeHidden && !includeDetails) response.headers.set('X-Admin-List-Mode', 'compact-v1')
  return response
}

export async function POST(request: Request) {
  let body
  try { body = await request.json() } catch { return NextResponse.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 }) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: '상품 정보를 확인해주세요.' }, { status: 400 })
  const supplierError = await validateSupplierSelection(request, body)
  if (supplierError) return NextResponse.json({ error: supplierError }, { status: 400 })
  const validationError = productValidationError(body)
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })
  const row = productBodyToRow(body)

  // 신규 상품은 기존 순서를 건드리지 않고 관리 페이지 맨 위에 추가한다.
  const { data: firstProduct, error: sortError } = await supabase
    .from('products')
    .select('sort_order')
    .neq('id', BRAND_REGISTRY_PRODUCT_ID)
    .neq('id', CATEGORY_REGISTRY_PRODUCT_ID)
    .neq('id', PRODUCT_META_REGISTRY_PRODUCT_ID)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (sortError) return NextResponse.json({ error: '상품 목록 조회에 실패했습니다. 잠시 후 다시 등록해주세요.' }, { status: 503 })
  const firstSortOrder = Number(firstProduct?.sort_order)
  const sortOrder = Number.isFinite(firstSortOrder) ? firstSortOrder - PRODUCT_SORT_ORDER_STEP : PRODUCT_SORT_ORDER_STEP

  const { data, error } = await supabase
    .from('products')
    .insert([{ ...row, id: crypto.randomUUID(), is_live: false, sort_order: sortOrder }] as unknown[])
    .select(PRODUCT_PUBLIC_SELECT)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const product = rowToProduct(data as DbProduct)
  const metaError = await updateProductMetaRegistryEntry(product.id, productMeta(product))
  if (metaError) console.error('Failed to update product meta registry', metaError.message)
  return NextResponse.json({ ...product, ...(metaError ? { warning: PRODUCT_META_WARNING } : {}) }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
}
