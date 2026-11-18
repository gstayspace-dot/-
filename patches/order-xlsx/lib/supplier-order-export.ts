import { createOrderWorkbook, orderWorkbookRow, type OrderWorkbookSheet } from './order-workbook'
import type { DbOrder, DbOrderItem } from './supabaseClient'

export type SupplierExportRow = {
  order: DbOrder; item: DbOrderItem; supplierId: string | null; supplierName: string
  shippingFee: number | null; historical: boolean
}
export function exportDateRange(from: string, to: string) {
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
  if (!valid(from) || !valid(to) || from > to) throw new Error('시작일과 종료일을 확인해주세요.')
  return { start: `${from}T00:00:00+09:00`, end: new Date(Date.parse(`${to}T00:00:00+09:00`) + 86400000).toISOString() }
}
export function supplierOrderExcel(rows: SupplierExportRow[]): ArrayBuffer {
  const sorted = [...rows].sort((a, b) => a.supplierName.localeCompare(b.supplierName, 'ko') || a.order.created_at.localeCompare(b.order.created_at) || a.order.id.localeCompare(b.order.id) || a.item.id.localeCompare(b.item.id))
  const sheets = new Map<string, OrderWorkbookSheet>()
  for (const row of sorted) {
    const key = row.supplierId ?? 'default'
    let sheet = sheets.get(key)
    if (!sheet) { sheet = { name: row.supplierName || '기본배송', rows: [] }; sheets.set(key, sheet) }
    sheet.rows.push(orderWorkbookRow(row.order, row.item.product_name, row.item.quantity))
  }
  return createOrderWorkbook(Array.from(sheets.values()))
}
