'use client'
import { useEffect, useRef, useState } from 'react'
import { useLiveCurrent } from '@/lib/use-live-current'
import { won, type LiveProduct } from '@/lib/live-overlay'

function Thumbnail({ item }: { item: LiveProduct }) {
  const [failed, setFailed] = useState(false)
  return failed ? <div className="h-24 w-24 grid place-items-center rounded bg-gray-100 text-xs text-gray-500">이미지 없음</div> : <img src={item.image_url} alt={item.name} className="h-24 w-24 rounded bg-white object-contain" loading="lazy" onError={() => setFailed(true)} />
}
export default function LiveControl() {
  const [items, setItems] = useState<LiveProduct[]>([])
  const [query, setQuery] = useState(''), [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0), [more, setMore] = useState(false), [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(''), [listError, setListError] = useState('')
  const locked = useRef(false)
  const { current, setCurrent, error } = useLiveCurrent(busy)
  const [overlay, setOverlay] = useState('/live/overlay')
  useEffect(() => { setOverlay(`${location.origin}/live/overlay`) }, [])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setListError(''); setItems([])
    void fetch(`/api/live/products?q=${encodeURIComponent(search)}&offset=${offset}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || '조회 실패'); return data })
      .then(data => { if (!controller.signal.aborted) { setItems(data.items); setMore(data.has_more); setTotal(data.total) } })
      .catch(e => { if (!controller.signal.aborted) { setListError(e.message); setMore(false) } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [search, offset])
  async function send(item?: LiveProduct) {
    if (locked.current || !current) return
    locked.current = true; setBusy(true); setMessage('')
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 8000)
    try {
      const response = await fetch('/api/live/current', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visible: Boolean(item), ...(item ? { product_id: item.id } : {}), revision: current.revision }), signal: controller.signal })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '방송 변경 실패')
      setCurrent(data); setMessage(item ? `${item.name} 송출 선택 완료` : '그래픽 숨김 완료')
    } catch (e) { setCurrent(null); setMessage(e instanceof Error && e.name !== 'AbortError' ? e.message : '응답을 확인하지 못했습니다. 현재 방송 상태를 확인해주세요.') }
    finally { clearTimeout(timeout); locked.current = false; setBusy(false) }
  }
  return <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
    <div className="mx-auto max-w-7xl">
      <header className="flex flex-wrap items-center justify-between gap-4"><div><a href="/admin/products" className="text-sm underline">← 상품 관리</a><h1 className="mt-3 text-3xl font-black">OBS 방송 컨트롤</h1><p className="mt-2 text-sm text-slate-600">홈페이지에 등록된 상품과 가격으로 방송합니다. 약 2초 간격으로 상태를 확인합니다.</p></div><button onClick={() => void send()} disabled={busy || !current} className="rounded-xl bg-slate-900 px-6 py-4 font-bold text-white disabled:opacity-40">그래픽 숨기기</button></header>
      <section className="my-6 rounded-2xl border bg-white p-5" aria-label="현재 방송 상태">
        <p className="font-bold">{current ? current.visible ? `현재 송출: ${current.product?.name}` : '현재 상태: 그래픽 숨김' : '현재 상태 확인 중 / 연결 확인 필요'}</p>
        {current?.visible && current.product && <p className="mt-2 text-red-600">라이브 판매가 {won(current.product.sale_price)} · {current.product.discount_percent}% 할인</p>}
        <p role="status" className="mt-2 text-sm">{message || error || '상품을 선택한 뒤 방송 송출을 누르세요.'}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm"><a href={overlay} target="_blank" rel="noreferrer" className="underline">오버레이 미리보기 ↗</a><code className="break-all">{overlay}</code><button className="rounded border px-3 py-2" onClick={() => { void navigator.clipboard.writeText(overlay).then(() => setMessage('OBS 주소 복사 완료')).catch(() => setMessage('위 주소를 직접 복사해주세요.')) }}>OBS 주소 복사</button></div>
        <p className="mt-2 text-xs text-slate-500">OBS 브라우저 소스: 1080 × 300 · 배경 투명. 송출 직후부터 7분 표시 → 7분 숨김을 반복하며, 커지면서 등장하고 작아지면서 사라집니다. 다시 송출하면 표시 주기가 새로 시작됩니다. 위치는 OBS에서 조절하세요. URL에 ?x=0&y=20을 붙이면 소스 내부 여백을 조절할 수 있습니다.</p>
      </section>
      <form onSubmit={e => { e.preventDefault(); setOffset(0); setSearch(query.trim()) }} className="mb-5 flex gap-3"><input aria-label="상품명 검색" value={query} onChange={e => setQuery(e.target.value)} placeholder="상품명 검색" className="min-w-0 flex-1 rounded-xl border p-3" /><button className="rounded-xl bg-red-600 px-6 font-bold text-white">검색</button></form>
      {listError && <p role="alert" className="mb-4 text-red-700">{listError} <a href="/admin/login?from=/admin/live-control" className="underline">관리자 재로그인</a></p>}
      <p className="mb-3 text-sm text-slate-500">{loading ? '상품 불러오는 중…' : `검색 결과 ${total}개 · ${Math.floor(offset / 30) + 1}페이지`}</p>
      <div className="grid gap-4 lg:grid-cols-2">{items.map(item => <article key={item.id} aria-label={item.name} className={`flex gap-4 rounded-2xl border-2 bg-white p-5 ${current?.visible && current.product?.id === item.id ? 'border-red-600' : 'border-transparent'}`}>
        <Thumbnail item={item} /><div className="min-w-0 flex-1"><h2 className="break-words font-bold">{item.name}</h2><p className="mt-2 text-sm text-slate-500">정상가 {typeof item.original_price === 'number' ? won(item.original_price) : '오류'}</p><p className="text-xl font-black text-red-600">{typeof item.sale_price === 'number' ? won(item.sale_price) : '가격 오류'}</p><p className="text-sm">{item.error || `${won(item.discount_amount)} 할인 · ${item.discount_percent}%`}</p><button disabled={busy || !current || Boolean(item.error)} onClick={() => void send(item)} className="mt-3 rounded-lg bg-red-600 px-5 py-3 font-bold text-white disabled:bg-slate-300">{current?.visible && current.product?.id === item.id ? '다시 송출' : '방송 송출'}</button></div>
      </article>)}</div>
      {!loading && !listError && !items.length && <p className="p-8 text-center">검색된 상품이 없습니다.</p>}
      <nav className="mt-6 flex justify-center gap-4" aria-label="상품 페이지"><button disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 30))} className="rounded border bg-white px-5 py-3 disabled:opacity-30">이전</button><button disabled={loading || !more} onClick={() => setOffset(offset + 30)} className="rounded border bg-white px-5 py-3 disabled:opacity-30">다음</button></nav>
    </div>
  </main>
}
