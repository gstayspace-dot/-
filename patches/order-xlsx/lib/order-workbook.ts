/** Native .xlsx export shared by browser and server purchase-order downloads. */
export const ORDER_WORKBOOK_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const ORDER_WORKBOOK_HEADERS = ['쇼핑MD', '주문자', '날짜', '품명', '수량', '받는사람', '배송 주소', '연락처', '배송메모'] as const
export type OrderWorkbookRow = [string, string, string, string, number | string, string, string, string, string]
export type OrderWorkbookSheet = { name: string; rows: OrderWorkbookRow[] }
type OrderDetails = {
  customer_name: string; customer_address: string; customer_phone: string; created_at: string; customer_request: string
  recipient_name?: string | null; recipient_address?: string | null; recipient_phone?: string | null
}

export function orderDeliveryMemo(raw: string): string {
  return (raw ?? '').split(' | ').filter(part => !part.startsWith('[')).join(' | ').trim()
}
export function formatOrderWorkbookPhone(value: string): string {
  const original = String(value ?? '').trim()
  if (!/^[\d\s()+-]+$/.test(original)) return original
  let digits = original.replace(/\D/g, '')
  if (digits.startsWith('8210') && digits.length === 12) digits = `0${digits.slice(2)}`
  if (/^01\d\d{8}$/.test(digits)) return digits.replace(/^(\d{3})(\d{4})(\d{4})$/, '$1-$2-$3')
  if (/^02\d{7,8}$/.test(digits)) return digits.replace(/^(02)(\d{3,4})(\d{4})$/, '$1-$2-$3')
  if (/^0\d{9,10}$/.test(digits)) return digits.replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3')
  return original
}
export function orderWorkbookRow(order: OrderDetails, product: string, quantity: number, memo = orderDeliveryMemo(order.customer_request)): OrderWorkbookRow {
  const date = new Date(order.created_at)
  const day = Number.isNaN(date.getTime()) ? '' : new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 10)
  return ['', order.customer_name, day, product, quantity || '', order.recipient_name ?? order.customer_name,
    order.recipient_address ?? order.customer_address, formatOrderWorkbookPhone(order.recipient_phone ?? order.customer_phone), memo]
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const WIDTHS = [12.15, 12.15, 13.58, 45, 9.3, 15, 59.3, 20.72, 33.58]
const escapeXml = (value: unknown) => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
function safeSheetNames(sheets: OrderWorkbookSheet[]) {
  const used = new Set<string>()
  const truncate = (value: string, length: number) => { const chars = Array.from(value); while (chars.join('').length > length) chars.pop(); return chars.join('') }
  return sheets.map(sheet => {
    let base = sheet.name.replace(/[\\/*?:\[\]\u0000-\u001f]/g, '_').trim().replace(/^'+|'+$/g, '') || '발주서'
    if (base.toLowerCase() === 'history') base = '배송처 History'
    base = truncate(base, 31)
    let name = base, index = 2
    while (used.has(name.toLowerCase())) { const suffix = ` (${index++})`; name = truncate(base, 31 - suffix.length) + suffix }
    used.add(name.toLowerCase()); return name
  })
}
function textCell(address: string, text: unknown, style: number) {
  // inlineStr is always literal text, including leading zeros and =/+/@/- prefixes.
  return `<c r="${address}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`
}
function dateSerial(day: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const stamp = Date.parse(day + 'T00:00:00Z')
  return Number.isFinite(stamp) ? Math.round(stamp / 86400000) + 25569 : null
}
function rowHeight(row: OrderWorkbookRow) {
  let lines = 1
  for (const col of [3, 6, 8]) {
    const value = String(row[col] ?? '')
    const count = value.split(/\r?\n/).reduce((sum, line) => sum + Math.max(1, Math.ceil(Array.from(line).reduce((width, char) => width + (char.charCodeAt(0) > 255 ? 2 : 1), 0) / (WIDTHS[col] - 2))), 0)
    lines = Math.max(lines, count)
  }
  return Math.min(409, Math.max(24, lines * 15 + 6))
}
function worksheet(rows: OrderWorkbookRow[]) {
  if (rows.length > 1048575) throw new Error('한 시트의 엑셀 최대 행 수를 초과했습니다. 조회 기간을 나눠주세요.')
  const header = `<row r="1" ht="25" customHeight="1">${ORDER_WORKBOOK_HEADERS.map((v, c) => textCell(`${String.fromCharCode(65 + c)}1`, v, 1)).join('')}</row>`
  const body = rows.map((row, index) => {
    const r = index + 2
    const cells = ORDER_WORKBOOK_HEADERS.map((_, col) => {
      const address = `${String.fromCharCode(65 + col)}${r}`, value = row[col]
      if (col === 4 && typeof value === 'number' && Number.isFinite(value)) return `<c r="${address}" s="4"><v>${value}</v></c>`
      if (col === 2) { const serial = dateSerial(String(value)); if (serial !== null) return `<c r="${address}" s="5"><v>${serial}</v></c>` }
      return textCell(address, value, [3, 6, 8].includes(col) ? 3 : col === 7 ? 6 : 2)
    }).join('')
    return `<row r="${r}" ht="${rowHeight(row)}" customHeight="1">${cells}</row>`
  }).join('')
  return `${XML}<worksheet xmlns="${MAIN}"><dimension ref="A1:I${rows.length + 1}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="24"/><cols>${WIDTHS.map((width, col) => `<col min="${col + 1}" max="${col + 1}" width="${width}" customWidth="1"/>`).join('')}</cols><sheetData>${header}${body}</sheetData><pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>`
}
function styles() {
  const font = '<sz val="11"/><color rgb="FF000000"/><name val="Malgun Gothic"/><family val="2"/>'
  const border = '<border><left style="thin"><color rgb="FFB7B7B7"/></left><right style="thin"><color rgb="FFB7B7B7"/></right><top style="thin"><color rgb="FFB7B7B7"/></top><bottom style="thin"><color rgb="FFB7B7B7"/></bottom><diagonal/></border>'
  const xf = (fontId: number, fillId: number, numFmtId: number, alignment: string) => `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" ${alignment}/></xf>`
  return `${XML}<styleSheet xmlns="${MAIN}"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><fonts count="2"><font>${font}</font><font><b/>${font}</font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>${border}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>${xf(1,2,0,'horizontal="center"')}${xf(0,0,0,'horizontal="left"')}${xf(0,0,0,'horizontal="left" wrapText="1"')}${xf(0,0,1,'horizontal="center"')}${xf(0,0,164,'horizontal="center"')}${xf(0,0,49,'horizontal="left"')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`
}

// ZIP method 0 (stored) keeps the writer synchronous and portable in both runtimes.
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let crc = n; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; return crc >>> 0 })
function crc32(bytes: Uint8Array) { let crc = 0xffffffff; for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0 }
function zip(files: Array<[string, string]>): ArrayBuffer {
  const encoder = new TextEncoder(), local: Uint8Array[] = [], central: Uint8Array[] = []
  let offset = 0, centralLength = 0
  for (const [path, value] of files) {
    const name = encoder.encode(path), data = encoder.encode(value), crc = crc32(data)
    const header = new Uint8Array(30 + name.length), h = new DataView(header.buffer)
    h.setUint32(0,0x04034b50,true); h.setUint16(4,20,true); h.setUint16(12,33,true); h.setUint32(14,crc,true); h.setUint32(18,data.length,true); h.setUint32(22,data.length,true); h.setUint16(26,name.length,true); header.set(name,30)
    const record = new Uint8Array(46 + name.length), c = new DataView(record.buffer)
    c.setUint32(0,0x02014b50,true); c.setUint16(4,20,true); c.setUint16(6,20,true); c.setUint16(14,33,true); c.setUint32(16,crc,true); c.setUint32(20,data.length,true); c.setUint32(24,data.length,true); c.setUint16(28,name.length,true); c.setUint32(42,offset,true); record.set(name,46)
    local.push(header,data); central.push(record); offset += header.length + data.length; centralLength += record.length
  }
  const end = new Uint8Array(22), e = new DataView(end.buffer)
  e.setUint32(0,0x06054b50,true); e.setUint16(8,files.length,true); e.setUint16(10,files.length,true); e.setUint32(12,centralLength,true); e.setUint32(16,offset,true)
  const output = new Uint8Array(offset + centralLength + end.length)
  let at = 0
  for (const chunk of [...local,...central,end]) { output.set(chunk,at); at += chunk.length }
  return output.buffer as ArrayBuffer
}
export function createOrderWorkbook(input: OrderWorkbookSheet[]): ArrayBuffer {
  const sheets = input.length ? input : [{ name: '발주서', rows: [] }], names = safeSheetNames(sheets)
  return zip([
    ['[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `${XML}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><bookViews><workbookView/></bookViews><sheets>${names.map((name,i)=>`<sheet name="${escapeXml(name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="${REL}/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length+1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', styles()],
    ...sheets.map((sheet,i): [string,string] => [`xl/worksheets/sheet${i+1}.xml`, worksheet(sheet.rows)]),
  ])
}
