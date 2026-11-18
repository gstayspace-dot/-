import { receiptAdmin } from '@/lib/receipt-admin-auth'
import { NextResponse, type NextRequest } from 'next/server'
import { receiptDb } from '@/lib/receipt-db'
import { BRAND_REGISTRY_PRODUCT_ID, CATEGORY_REGISTRY_PRODUCT_ID, PRODUCT_META_REGISTRY_PRODUCT_ID, parseProductMetaRegistry, splitSpecsAndDescription } from '@/lib/supabaseClient'

export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest) {
  if (!(await receiptAdmin(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const params = request.nextUrl.searchParams
  const offset = Number(params.get('offset') || 0)
  if (!Number.isSafeInteger(offset) || offset < 0) return NextResponse.json({ error: '잘못된 페이지입니다.' }, { status: 400 })
  const search = (params.get('q') || '').trim().slice(0, 100)
  if (!search) return NextResponse.json({ products: [], nextOffset: 0, hasMore: false })
  const db = receiptDb()
  if (!db) return NextResponse.json({ error: '관리자 상품 조회 설정을 확인해주세요.' }, { status: 503 })
  let query = db.from('products').select('id,name,live_price,supplier_id,specs', { count: 'exact' })
    .neq('id', BRAND_REGISTRY_PRODUCT_ID).neq('id', CATEGORY_REGISTRY_PRODUCT_ID).neq('id', PRODUCT_META_REGISTRY_PRODUCT_ID)
  for (const keyword of search.split(/\s+/)) query = query.ilike('name', `%${keyword.replace(/[\\%_]/g, '\\$&')}%`)
  const [{ data, error, count }, metadata] = await Promise.all([
    query.order('sort_order', { ascending: true, nullsFirst: false }).order('id', { ascending: true }).range(offset, offset + 9),
    db.from('products').select('specs').eq('id', PRODUCT_META_REGISTRY_PRODUCT_ID).maybeSingle(),
  ])
  if (error || metadata.error) return NextResponse.json({ error: '상품을 불러오지 못했습니다.' }, { status: 500 })
  const registry = parseProductMetaRegistry(metadata.data?.specs)
  const products = (data ?? []).map(p => ({ id: p.id, name: p.name, livePrice: p.live_price, supplierId: p.supplier_id ?? null,
    isVisible: splitSpecsAndDescription(p.specs ?? '').isVisible && registry[p.id]?.isVisible !== false }))
  const nextOffset = offset + products.length
  return NextResponse.json({ products, nextOffset, hasMore: products.length > 0 && nextOffset < (count ?? nextOffset) }, { headers: { 'Cache-Control': 'no-store' } })
}
