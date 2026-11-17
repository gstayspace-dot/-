import { NextResponse, type NextRequest } from 'next/server'
import { receiptAdmin } from '@/lib/receipt-admin-auth'
import { receiptDb } from '@/lib/receipt-db'
import { supabase, rowToProduct, PRODUCT_PUBLIC_SELECT, readProductMetaRegistry, savePurchaseConfig, type DbProduct } from '@/lib/supabaseClient'
import { type PurchaseChoice, type PurchaseConfig } from '@/lib/purchase-config'
import { purchaseGroups } from '@/lib/purchase-config-server'
export const dynamic = 'force-dynamic'
const validId = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) && !id.startsWith('00000000-')
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  if (!validId(params.id)) return NextResponse.json({ error: '상품 ID를 확인해주세요.' }, { status: 400 })
  const { data, error } = await supabase.from('products').select(PRODUCT_PUBLIC_SELECT).eq('id', params.id).single()
  if (error) return NextResponse.json({ error: '상품 구성을 불러오지 못했습니다.' }, { status: 503 })
  const registry = await readProductMetaRegistry()
  const config = registry[params.id]?.purchaseConfig ?? { variants: [], addons: [] }
  const ids = Array.from(new Set([params.id, ...config.variants.map(c => c.productId), ...config.addons.map(c => c.productId)]))
  const products = await supabase.from('products').select('id,name,live_price,quantity,supplier_id').in('id', ids)
  if (products.error) return NextResponse.json({ error: '구성상품 조회에 실패했습니다.' }, { status: 503 })
  return NextResponse.json({ config, products: products.data.map(row => row.id === params.id ? { ...rowToProduct(data as DbProduct), ...(registry[row.id] ?? {}), imageUrl: `/api/products/${row.id}/image` } : { id: row.id, name: row.name, livePrice: row.live_price, quantity: row.quantity, supplierId: row.supplier_id, isVisible: registry[row.id]?.isVisible !== false }), version: JSON.stringify(config) }, { headers: { 'Cache-Control': 'no-store' } })
}
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  if (!await receiptAdmin(request)) return NextResponse.json({ error: '관리자 로그인이 필요합니다.' }, { status: 401 })
  try {
    if (!validId(params.id)) throw Error('상품 ID를 확인해주세요.')
    const body = await request.json(), config: PurchaseConfig = body.config
    if (!config || !Array.isArray(config.variants) || !Array.isArray(config.addons) || config.variants.length + config.addons.length > 100) throw Error('구성은 최대 100개까지 등록할 수 있습니다.')
    if (config.title !== undefined && (typeof config.title !== 'string' || config.title.length > 200)) throw Error('대표 상품 표시명을 확인해주세요.')
    const choices: PurchaseChoice[] = [...config.variants, ...config.addons]
    if (choices.some(c => !c || !validId(c.productId) || typeof c.label !== 'string' || !c.label.trim() || c.label.length > 200) || new Set(choices.map(c => c.productId)).size !== choices.length || config.addons.some(c => c.productId === params.id)) throw Error('구성 이름과 중복 상품을 확인해주세요.')
    const db = receiptDb(); if (!db) throw Error('서버 설정을 확인해주세요.')
    const { error } = await db.from('products').select('id').eq('id', params.id).single()
    if (error) throw Error('대표 상품을 찾지 못했습니다.')
    const registry = await readProductMetaRegistry()
    if (body.version !== JSON.stringify(registry[params.id]?.purchaseConfig ?? { variants: [], addons: [] })) return NextResponse.json({ error: '상품이 변경되었습니다. 다시 불러온 뒤 저장해주세요.' }, { status: 409 })
    const { groups } = await purchaseGroups()
    const ids = choices.map(c => c.productId)
    if (ids.length && groups.some(g => g.id !== params.id && (ids.includes(g.id) || [...g.variants, ...g.addons].some(c => c.productId === params.id || ids.includes(c.productId))))) throw Error('다른 대표 상품에 연결된 구성상품입니다. 기존 연결을 먼저 해제해주세요.')
    if (ids.length) {
      const found = await db.from('products').select('id').in('id', ids)
      if (found.error || found.data?.length !== ids.length) throw Error('존재하지 않는 구성상품입니다.')
    }
    const saveError = await savePurchaseConfig(params.id, config, body.version)
    if (saveError) return NextResponse.json({ error: saveError.message }, { status: 409 })
    return NextResponse.json({ ok: true })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : '구성 저장 실패' }, { status: 400 }) }
}
