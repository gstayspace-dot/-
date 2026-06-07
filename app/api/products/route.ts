import { NextResponse } from 'next/server'
import { supabase, rowToProduct, productBodyToRow, type DbProduct } from '@/lib/supabaseClient'

export async function GET() {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(((data ?? []) as DbProduct[]).map(rowToProduct))
}

export async function POST(request: Request) {
  const body = await request.json()
  const row = productBodyToRow(body)

  const { data, error } = await supabase
    .from('products')
    .insert([{ ...row, id: crypto.randomUUID(), is_live: false }] as unknown[])
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(rowToProduct(data as DbProduct), { status: 201 })
}
