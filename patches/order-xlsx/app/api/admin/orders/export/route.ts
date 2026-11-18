import { NextRequest, NextResponse } from 'next/server'
import { receiptAdmin } from '@/lib/receipt-admin-auth'
import { supabase, fetchOrderItemsForOrders, type DbOrder } from '@/lib/supabaseClient'
import { loadShippingSuppliers } from '@/lib/shipping-server'
import { DEFAULT_SHIPPING_NAME } from '@/lib/shipping-quote'
import { ORDER_WORKBOOK_MIME } from '@/lib/order-workbook'
import { exportDateRange, supplierOrderExcel, type SupplierExportRow } from '@/lib/supplier-order-export'
export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest) {
  if (!(await receiptAdmin(request))) return NextResponse.json({ error: '관리자로 다시 로그인해주세요.' }, { status: 401 })
  const params = request.nextUrl.searchParams, from = params.get('from') ?? '', to = params.get('to') ?? '', supplier = params.get('supplier') ?? 'all'
  let range
  try { range = exportDateRange(from, to) } catch { return NextResponse.json({ error: '조회 날짜를 확인해주세요.' }, { status: 400 }) }
  if (!['all', 'default'].includes(supplier) && !/^[0-9a-f-]{36}$/i.test(supplier)) return NextResponse.json({ error: '배송처를 확인해주세요.' }, { status: 400 })
  try {
    const orders: DbOrder[] = []
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await supabase.from('orders').select('*').gte('created_at', range.start).lt('created_at', range.end).is('deleted_at', null).order('created_at').order('id').range(offset, offset + 499)
      if (error) throw new Error('주문 조회 실패')
      orders.push(...data as DbOrder[])
      if (!data || data.length < 500) break
    }
    const result = await fetchOrderItemsForOrders(orders.map(order => order.id))
    if (result.error) throw new Error('주문 상품 조회 실패')
    const items = result.data ?? [], suppliers = await loadShippingSuppliers()
    const legacyIds = Array.from(new Set(items.filter(item => !item.supplier_name).map(item => item.product_id)))
    const current = new Map<string, string | null>()
    for (let offset = 0; offset < legacyIds.length; offset += 80) {
      const { data, error } = await supabase.from('products').select('id,supplier_id').in('id', legacyIds.slice(offset, offset + 80))
      if (error) throw new Error('배송처 조회 실패')
      data?.forEach(product => current.set(product.id, product.supplier_id))
    }
    const rows: SupplierExportRow[] = items.flatMap(item => {
      const order = orders.find(order => order.id === item.order_id)!
      const historical = !!item.supplier_name
      const supplierId = historical ? item.supplier_id ?? null : current.get(item.product_id) ?? null
      if (supplier !== 'all' && (supplier === 'default' ? supplierId !== null : supplierId !== supplier)) return []
      const supplierName = historical ? item.supplier_name! : suppliers.find(s => s.id === supplierId)?.name ?? DEFAULT_SHIPPING_NAME
      const shippingFee = order.shipping_breakdown?.find(group => group.supplierId === supplierId)?.shippingFee ?? null
      return [{ order, item, supplierId, supplierName, shippingFee, historical }]
    })
    const workbook = supplierOrderExcel(rows)
    return new NextResponse(workbook, { headers: { 'Content-Type': ORDER_WORKBOOK_MIME, 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `attachment; filename="supplier-orders-${from}-${to}.xlsx"`, 'Cache-Control': 'no-store', 'X-Export-Rows': String(rows.length) } })
  } catch { return NextResponse.json({ error: '배송처별 발주서를 만들지 못했습니다. 다시 시도해주세요.' }, { status: 503 }) }
}
