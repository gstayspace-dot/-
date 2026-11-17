import { purchaseGroups } from '@/lib/purchase-config-server'
import { validateSupplierSelection } from '@/lib/supplier-selection'
import { productValidationError, productMeta, PRODUCT_META_WARNING } from '@/lib/product-validation'
import { NextResponse } from 'next/server'
import { supabase, rowToProduct, productBodyToRow, readProductMetaRegistry, PRODUCT_PUBLIC_SELECT, removeProductMetaRegistryEntry, updateProductMetaRegistryEntry, type DbProduct } from '@/lib/supabaseClient'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const { data, error } = await supabase
    .from('products')
    .select(PRODUCT_PUBLIC_SELECT)
    .eq('id', params.id)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: error.code === 'PGRST116' ? 404 : 500 })
  const registry = await readProductMetaRegistry()
  return NextResponse.json({ ...rowToProduct(data as DbProduct), isSoldOut: registry[params.id]?.isSoldOut === true, purchaseConfig: registry[params.id]?.purchaseConfig }, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  let body
  try { body = await request.json() } catch { return NextResponse.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 }) }
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.keys(body).length) return NextResponse.json({ error: '수정할 정보를 입력해주세요.' }, { status: 400 })
  const { data: current, error: readError } = await supabase.from('products')
    .select(PRODUCT_PUBLIC_SELECT).eq('id', params.id).single()
  if (readError) return NextResponse.json({ error: '상품 상세 정보를 불러오지 못했습니다. 다시 시도해주세요.' }, { status: readError.code === 'PGRST116' ? 404 : 503 })
  const currentProduct = rowToProduct(current as DbProduct)
  const merged = { ...currentProduct, ...body }
  // A list image endpoint is a preview, never a replacement for stored image data.
  if (merged.imageUrl === `/api/products/${params.id}/image`) merged.imageUrl = currentProduct.imageUrl
  const supplierError = await validateSupplierSelection(request, body)
  if (supplierError) return NextResponse.json({ error: supplierError }, { status: 400 })
  const validationError = productValidationError(merged)
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })
  const row = productBodyToRow(merged)
  const metaOnly = Object.keys(body).every(key => ['isBest','isVisible','brand','category'].includes(key))
  const { data, error } = await supabase.from('products')
    .update((metaOnly ? { specs: row.specs } : row) as Record<string, unknown>)
    .eq('id', params.id).select(PRODUCT_PUBLIC_SELECT).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const product = rowToProduct(data as DbProduct)
  const metaError = await updateProductMetaRegistryEntry(product.id, productMeta(product))
  if (metaError) console.error('Failed to update product meta registry', metaError.message)
  return NextResponse.json({ ...product, ...(metaError ? { warning: PRODUCT_META_WARNING } : {}) }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const { groups, members } = await purchaseGroups()
  if (members.has(params.id) || groups.some(g => g.id === params.id && (g.variants.length || g.addons.length))) return NextResponse.json({ error: '옵션 구성을 먼저 해제한 뒤 상품을 삭제해주세요.' }, { status: 409 })
  const { error } = await supabase
    .from('products')
    .delete()
    .eq('id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const metaError = await removeProductMetaRegistryEntry(params.id)
  if (metaError) console.error('Failed to remove product meta registry entry', metaError.message)
  return NextResponse.json({ success: true })
}
