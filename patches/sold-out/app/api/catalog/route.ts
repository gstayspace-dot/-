import { purchaseGroups } from '@/lib/purchase-config-server'
import { catalogFilters, searchableText } from '@/lib/catalog-filter'
import { storefrontCategory } from '@/lib/catalog-category'
import { NextResponse } from 'next/server'
import { supabase, parseProductMetaRegistry, rowToProductSummary, compareProducts, BRAND_REGISTRY_PRODUCT_ID, CATEGORY_REGISTRY_PRODUCT_ID, PRODUCT_META_REGISTRY_PRODUCT_ID, type DbProduct } from '@/lib/supabaseClient'

export const dynamic = 'force-dynamic'

// Read every page before filtering: a brand/search must include products beyond
// the first database page. Images are served lazily by the existing image route.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const filters = catalogFilters(params)
  const offset = Number(params.get('offset') || 0)
  if (!Number.isSafeInteger(offset) || offset < 0) return NextResponse.json({ error: '잘못된 페이지입니다.' }, { status: 400 })
  const { data: registryRows, error: registryError } = await supabase.from('products').select('id,specs').in('id', [PRODUCT_META_REGISTRY_PRODUCT_ID, BRAND_REGISTRY_PRODUCT_ID, CATEGORY_REGISTRY_PRODUCT_ID])
  if (registryError) return NextResponse.json({ error: '상품 분류를 불러오지 못했습니다.' }, { status: 503 })
  const registry = parseProductMetaRegistry(registryRows?.find(row => row.id === PRODUCT_META_REGISTRY_PRODUCT_ID)?.specs)
  const rows: DbProduct[] = []
  for (let start = 0; ; start += 500) {
    const { data, error } = await supabase.from('products')
      .select('id,name,original_price,live_price,quantity,is_live,created_at,sort_order')
      .neq('id', BRAND_REGISTRY_PRODUCT_ID).neq('id', CATEGORY_REGISTRY_PRODUCT_ID).neq('id', PRODUCT_META_REGISTRY_PRODUCT_ID)
      .order('id', { ascending: true }).range(start, start + 499)
    if (error) return NextResponse.json({ error: '상품을 불러오지 못했습니다. 다시 시도해주세요.' }, { status: 503 })
    rows.push(...(data ?? []) as DbProduct[])
    if (!data || data.length < 500) break
  }
  const { groups, members } = await purchaseGroups()
  const visible = rows.map(row => ({ ...rowToProductSummary(row), ...(registry[row.id] ?? {}), imageUrl: `/api/products/${row.id}/image` })).filter(p => p.isVisible && !members.has(p.id)).map(p => { const group = groups.find(g => g.id === p.id); return { ...p, name: group?.title || p.name, purchaseConfig: group, isLive: p.isLive || !!group?.variants.some(c => rows.find(r => r.id === c.productId)?.is_live), quantity: group?.variants.length ? group.variants.reduce((sum,c) => sum + (registry[c.productId]?.isVisible === false || registry[c.productId]?.isSoldOut === true ? 0 : rows.find(r => r.id === c.productId)?.quantity ?? 0),0) : p.isSoldOut ? 0 : p.quantity } })
  const categoryCounts: Record<string, number> = {}
  for (const product of visible) {
    const category = storefrontCategory(product.category)
    categoryCounts[category] = (categoryCounts[category] || 0) + 1
  }
  // Offer groups that actually contain visible products, including unclassified
  // products. Counts are global and never shrink with a previous search/tab.
  const brands = Array.from(new Set(visible.map(p => p.brand).filter(Boolean))).sort((a,b) => a.localeCompare(b, 'ko'))
  const categories = Object.keys(categoryCounts).sort((a,b) => a.localeCompare(b, 'ko'))
  const words = filters.q.split(/\s+/).filter(Boolean).map(searchableText)
  const tab = filters.tab
  const products = visible.filter(p =>
    (tab !== 'live' || p.isLive) && (tab !== 'best' || p.isBest) &&
    (!filters.brand || p.brand === filters.brand) &&
    (!filters.category || storefrontCategory(p.category) === filters.category) &&
    words.every(word => searchableText(`${p.name} ${p.brand} ${p.category} ${(p.purchaseConfig?.variants ?? []).map(c => c.label).join(' ')}`).includes(word)))
  const sort = params.get('sort') || (tab === 'new' ? 'new' : 'recommended')
  products.sort((a,b) => {
    if (sort === 'new' || tab === 'new') return b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)
    if (sort === 'price-low') return a.livePrice - b.livePrice || compareProducts(a,b)
    if (sort === 'price-high') return b.livePrice - a.livePrice || compareProducts(a,b)
    return compareProducts(a,b) || a.id.localeCompare(b.id)
  })
  const page = products.slice(offset, offset + 24)
  return NextResponse.json({ products: page, total: products.length, nextOffset: offset + page.length, hasMore: offset + page.length < products.length, brands, categories, categoryCounts, mode: filters.mode }, { headers: { 'Cache-Control': 'no-store' } })
}
