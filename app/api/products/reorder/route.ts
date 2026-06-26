import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabaseClient'

// 전체 상품 노출 순서를 한 번에 저장한다.
// body: { orderedIds: string[] } — 화면에 보이는 순서대로 정렬된 상품 id 배열
export async function POST(request: Request) {
  const { orderedIds } = (await request.json()) as { orderedIds?: unknown }

  if (!Array.isArray(orderedIds) || orderedIds.some(id => typeof id !== 'string')) {
    return NextResponse.json({ error: 'orderedIds must be an array of strings' }, { status: 400 })
  }

  // 각 상품의 sort_order 를 배열 인덱스로 갱신
  const results = await Promise.all(
    (orderedIds as string[]).map((id, index) =>
      supabase.from('products').update({ sort_order: index }).eq('id', id),
    ),
  )

  const failed = results.find(r => r.error)
  if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
