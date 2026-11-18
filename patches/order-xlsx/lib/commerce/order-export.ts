import { createOrderWorkbook, orderWorkbookRow } from '../order-workbook'
import { orderItemLabel, type AdminOrderWithItems, type AdminOrderItem } from './admin-orders'

function escapeExcelText(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatOrderDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).replace(/\. /g, '-').replace('.', '')
}

function parseOrderRequest(raw: string): { payment: string; request: string } {
  const parts = (raw ?? '').split(' | ')
  const payment = (parts.find(part => part.startsWith('[')) ?? '').replace(/^\[|\]$/g, '')
  const request = parts.filter(part => !part.startsWith('[')).join(' | ').trim()
  return { payment, request }
}

export function buildOrderWorkbook(orders: AdminOrderWithItems[]): ArrayBuffer {
  const rows = orders.flatMap(order => {
    const memo = order.commerce_version === 2 ? order.customer_request : parseOrderRequest(order.customer_request).request
    const items = order.items.length ? order.items : [{ id: `${order.id}-empty`, product_name: '', quantity: 0 }] as AdminOrderItem[]
    return items.map(item => orderWorkbookRow(order, orderItemLabel(item, order.items), item.quantity, memo))
  })
  return createOrderWorkbook([{ name: '발주서', rows }])
}

export function buildOrderSheetHtml(orders: AdminOrderWithItems[]): string {
  const rows = orders.flatMap(order => {
    const request = order.commerce_version === 2 ? order.customer_request : parseOrderRequest(order.customer_request).request
    const items = order.items.length > 0
      ? order.items
      : [{ id: `${order.id}-empty`, product_name: '', quantity: 0 }] as AdminOrderItem[]

    return items.map(item => [
      '',
      order.customer_name,
      formatOrderDate(order.created_at),
      orderItemLabel(item, order.items),
      item.quantity || '',
      order.recipient_name ?? order.customer_name,
      order.recipient_address ?? order.customer_address,
      order.recipient_phone ?? order.customer_phone,
      request,
    ])
  })

  const bodyRows = rows.map(row => `
    <tr>
      ${row.map(value => `<td>${escapeExcelText(value)}</td>`).join('')}
    </tr>
  `).join('')

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    table { border-collapse: collapse; font-family: "Malgun Gothic", Arial, sans-serif; font-size: 11pt; }
    th, td { border: 1px solid #b7b7b7; padding: 6px 8px; vertical-align: middle; white-space: nowrap; }
    th { background: #f2f2f2; font-weight: 700; text-align: center; }
    td:nth-child(4), td:nth-child(7), td:nth-child(9) { white-space: normal; }
    .shop-md { width: 90px; }
    .orderer { width: 90px; }
    .date { width: 100px; }
    .product { width: 320px; }
    .qty { width: 70px; text-align: center; }
    .receiver { width: 110px; }
    .address { width: 420px; }
    .phone { width: 150px; }
    .memo { width: 240px; }
  </style>
</head>
<body>
  <table>
    <thead>
      <tr>
        <th class="shop-md">쇼핑MD</th>
        <th class="orderer">주문자</th>
        <th class="date">날짜</th>
        <th class="product">품명</th>
        <th class="qty">수량</th>
        <th class="receiver">받는사람</th>
        <th class="address">배송 주소</th>
        <th class="phone">연락처</th>
        <th class="memo">배송메모</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows}
    </tbody>
  </table>
</body>
</html>`
}

