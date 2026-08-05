import { NextResponse } from 'next/server'
import { supabase, rowToProduct, productBodyToRow, PRODUCT_PUBLIC_SELECT, type DbProduct } from '@/lib/supabaseClient'
import { fallbackProducts } from '@/lib/fallbackProducts'

export async function GET() {
  const { data, error } = await supabase
    .from('products')
    .select(PRODUCT_PUBLIC_SELECT)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json(fallbackProducts)
  const products = ((data ?? []) as DbProduct[]).map(rowToProduct)
  return NextResponse.json(products.length > 0 ? products : fallbackProducts)
}

export async function POST(request: Request) {
  const body = await request.json()
  const row = productBodyToRow(body)

  // 신규 상품은 목록 맨 위에 노출 → 현재 최소 sort_order 보다 1 작게 배치
  const { data: top } = await supabase
    .from('products')
    .select('sort_order')
    .order('sort_order', { ascending: true, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  const sortOrder = (top?.sort_order ?? 1) - 1

  const { data, error } = await supabase
    .from('products')
    .insert([{ ...row, id: crypto.randomUUID(), is_live: false, sort_order: sortOrder }] as unknown[])
    .select(PRODUCT_PUBLIC_SELECT)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(rowToProduct(data as DbProduct), { status: 201 })
}
