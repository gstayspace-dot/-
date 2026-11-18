'use client'
import { useEffect, useState } from 'react'
import type { ShippingSupplier } from '@/lib/shipping-quote'
const todayKst = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)
export default function SupplierOrderExport() {
  const [from, setFrom] = useState(todayKst), [to, setTo] = useState(todayKst)
  const [supplier, setSupplier] = useState('all'), [suppliers, setSuppliers] = useState<ShippingSupplier[]>([])
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => { fetch('/api/admin/suppliers', { cache: 'no-store' }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); setSuppliers(data.suppliers) }).catch(error => setError(error.message || '배송처 조회 실패')) }, [])
  async function download() {
    setError(''); setBusy(true)
    try {
      const response = await fetch('/api/admin/orders/export?' + new URLSearchParams({ from, to, supplier }), { cache: 'no-store' })
      if (!response.ok) throw new Error((await response.json()).error)
      const url = URL.createObjectURL(await response.blob()), link = document.createElement('a')
      link.href = url; link.download = `배송처별-발주서-${from}-${to}.xlsx`; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) { setError(error instanceof Error ? error.message : '엑셀 다운로드 실패') }
    finally { setBusy(false) }
  }
  return <section className="mb-6 rounded-2xl border border-blue-200 bg-white p-4" aria-label="배송처별 발주서">
    <h2 className="text-sm font-extrabold mb-2">날짜·배송처별 발주서</h2>
    <div className="flex flex-wrap gap-2 items-end">
      <label className="text-xs text-gray-600">시작일<input aria-label="발주서 시작일" type="date" value={from} onChange={e => setFrom(e.target.value)} className="block border rounded-lg p-2 text-sm" /></label>
      <label className="text-xs text-gray-600">종료일<input aria-label="발주서 종료일" type="date" value={to} onChange={e => setTo(e.target.value)} className="block border rounded-lg p-2 text-sm" /></label>
      <label className="flex-1 min-w-36 text-xs text-gray-600">배송처<select aria-label="발주서 배송처" value={supplier} onChange={e => setSupplier(e.target.value)} className="block w-full border rounded-lg p-2 text-sm bg-white"><option value="all">전체 배송처 (배송처별 정렬)</option><option value="default">기본배송</option>{suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
      <button type="button" disabled={busy || !from || !to || from > to} onClick={() => void download()} className="rounded-lg bg-blue-600 text-white text-sm font-bold px-4 py-2 disabled:opacity-40">{busy ? '생성 중…' : '배송처별 엑셀 다운로드'}</button>
    </div>
    <p className="mt-2 text-xs text-gray-500">기존 발주서와 같은 9개 열의 엑셀 통합문서(.xlsx)로 저장합니다. 전체 배송처는 배송처별 시트로 나뉩니다. 한국시간 주문일 기준이며, 과거 배송처 기록이 없는 주문은 현재 상품 배송처로 분류합니다.</p>
    {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
  </section>
}
