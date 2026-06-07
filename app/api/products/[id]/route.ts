import { NextResponse } from 'next/server'
import { supabase, rowToProduct, productBodyToRow, type DbProduct } from '@/lib/supabaseClient'

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const body = await request.json()
  const { data, error } = await supabase
    .from('products')
    .update(productBodyToRow(body) as Record<string, unknown>)
    .eq('id', params.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: error.code === 'PGRST116' ? 404 : 500 })
  return NextResponse.json(rowToProduct(data as DbProduct))
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const { error } = await supabase
    .from('products')
    .delete()
    .eq('id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
