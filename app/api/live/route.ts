import { NextResponse } from 'next/server'
import { supabase, rowToProduct, type DbProduct } from '@/lib/supabaseClient'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

export async function GET() {
  const { data, error } = await db.from('products').select('*').eq('is_live', true)
  if (error) return NextResponse.json({ products: [] })
  return NextResponse.json({ products: ((data ?? []) as DbProduct[]).map(rowToProduct) })
}

export async function POST(request: Request) {
  const { productId } = await request.json()

  const { data: product } = await db.from('products').select('id').eq('id', productId).single()
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  const { error } = await db.from('products').update({ is_live: true }).eq('id', productId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, productId })
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json()
    if (body?.productId) {
      await db.from('products').update({ is_live: false }).eq('id', body.productId)
    } else {
      await db.from('products').update({ is_live: false }).eq('is_live', true)
    }
  } catch {
    await db.from('products').update({ is_live: false }).eq('is_live', true)
  }
  return NextResponse.json({ success: true })
}
