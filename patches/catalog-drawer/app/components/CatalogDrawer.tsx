'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname } from 'next/navigation'
import { isCustomerRoute } from '@/lib/customer-navigation'
import { drawerCatalog, drawerHref, drawerLabelMatches, type DrawerMetadata, type DrawerProduct } from '@/lib/catalog-drawer'
import styles from './CatalogDrawer.module.css'

export default function CatalogDrawer() {
  const pathname = usePathname()
  const [phase, setPhase] = useState<'closed' | 'open' | 'closing'>('closed')
  const visible = phase !== 'closed'
  const [tab, setTab] = useState<'brand' | 'category'>('brand')
  const [query, setQuery] = useState('')
  const [metadata, setMetadata] = useState<DrawerMetadata | null>(null)
  const cached = useRef<DrawerMetadata | null>(null)
  const [products, setProducts] = useState<DrawerProduct[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const panel = useRef<HTMLElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const launcher = useRef<HTMLButtonElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const id = useId()
  const allowed = isCustomerRoute(pathname)
  const text = query.trim()
  function close() {
    setPhase('closing')
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setPhase('closed'), 240)
  }
  useEffect(() => {
    setPhase('closed')
    if (closeTimer.current) clearTimeout(closeTimer.current)
  }, [pathname])
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])
  useEffect(() => {
    if (!visible || !allowed) return
    const overflow = document.body.style.overflow
    const trigger = launcher.current
    document.body.style.overflow = 'hidden'
    closeButton.current?.focus()
    return () => { document.body.style.overflow = overflow; if (trigger?.isConnected) trigger.focus() }
  }, [visible, allowed])
  useEffect(() => {
    if (!visible || !allowed) return
    setProducts([]); setTotal(0); setError('')
    if (!text && cached.current) { setLoading(false); return }
    const controller = new AbortController()
    let active = true
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ mode: text ? 'search' : 'tab', tab: 'all', offset: '0', ...(text ? { q: text } : {}) })
        const response = await fetch(`/api/catalog?${params}`, { cache: 'no-store', signal: controller.signal })
        const data = await response.json()
        if (!response.ok) throw new Error('상품 분류와 검색 결과를 불러오지 못했습니다.')
        if (!active) return
        const result = drawerCatalog(data)
        cached.current = result.metadata
        setMetadata(result.metadata); setProducts(result.products); setTotal(result.total)
      } catch {
        if (active && !controller.signal.aborted) setError('상품 정보를 불러오지 못했습니다. 다시 시도해주세요.')
      } finally { if (active) setLoading(false) }
    }, text ? 350 : 0)
    return () => { active = false; clearTimeout(timer); controller.abort() }
  }, [visible, allowed, text, retry])
  if (!allowed) return null
  const labels = (tab === 'brand' ? metadata?.brands : metadata?.categories)?.filter(value => drawerLabelMatches(value, text)) ?? []
  return <>
    <button ref={launcher} type="button" aria-label="브랜드·제품별 메뉴 열기" aria-haspopup="dialog" aria-expanded={visible} aria-controls={`${id}-panel`} onClick={() => setPhase('open')} className={`${styles.launcher} flex min-h-[76px] w-12 flex-col items-center justify-center rounded-r-2xl border border-l-0 border-orange-300 bg-white/95 text-orange-700 shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500`}>
      <span aria-hidden="true" className="text-3xl leading-8">⋮</span><span className="text-xs font-bold">메뉴</span>
    </button>
    {visible && createPortal(<div className="fixed inset-0 z-[90]" data-catalog-drawer="true">
      <div aria-hidden="true" className={`${styles.backdrop} ${phase === 'closing' ? styles.closing : ''} absolute inset-0 bg-black/50`} onClick={close} />
      <aside ref={panel} id={`${id}-panel`} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} className={`${styles.panel} ${phase === 'closing' ? styles.closing : ''} relative flex h-screen-safe w-[min(90vw,400px)] max-w-full flex-col bg-white shadow-2xl pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]`} onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); close() }
        if (event.key === 'Tab') {
          const nodes = Array.from(panel.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"])') ?? []).filter(node => node.getClientRects().length)
          const first = nodes[0], last = nodes[nodes.length - 1]
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
        }
      }}>
        <header className="flex shrink-0 items-center justify-between border-b px-5 py-3">
          <div><p className="text-xs font-bold text-orange-600">리빙라방</p><h2 id={`${id}-title`} className="text-xl font-extrabold text-gray-900">상품 찾기</h2></div>
          <button ref={closeButton} type="button" aria-label="상품 메뉴 닫기" onClick={close} className="min-h-12 min-w-12 rounded-xl text-2xl text-gray-700 hover:bg-gray-100">×</button>
        </header>
        <div className="shrink-0 border-b px-5 py-4">
          <form action="/" method="get" role="search" aria-label="메뉴 상품 검색" className="flex gap-2" onSubmit={event => { if (!text) { event.preventDefault(); searchInput.current?.focus() } }}>
            <label className="sr-only" htmlFor={`${id}-search`}>상품명 또는 브랜드 검색</label>
            <input ref={searchInput} id={`${id}-search`} name="q" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault() }} maxLength={100} placeholder="상품명·브랜드 검색" enterKeyHint="search" autoComplete="off" className="min-h-12 min-w-0 flex-1 rounded-xl border border-gray-300 px-3 text-base text-gray-900 focus:border-orange-500 focus:outline-none" />
            <button type="submit" disabled={!text} className="min-h-12 rounded-xl bg-orange-500 px-4 font-bold text-white disabled:opacity-40">검색</button>
          </form>
          <nav aria-label="쇼핑 바로가기" className="mt-3 grid grid-cols-3 gap-2 text-center text-sm font-bold">
            <a href="/" className="rounded-lg bg-orange-50 py-3 text-orange-700">전체 상품</a><a href="/cart" className="rounded-lg bg-gray-50 py-3 text-gray-700">장바구니</a><a href="/my-orders" className="rounded-lg bg-gray-50 py-3 text-gray-700">주문 조회</a>
          </nav>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-8 pt-4">
          <div className="mb-4 grid grid-cols-2 gap-2" role="group" aria-label="상품 분류 방식">
            <button type="button" aria-pressed={tab === 'brand'} onClick={() => setTab('brand')} className={`min-h-12 rounded-xl border text-base font-bold ${tab === 'brand' ? 'border-orange-500 bg-orange-500 text-white' : 'border-gray-200 text-gray-700'}`}>브랜드별</button>
            <button type="button" aria-pressed={tab === 'category'} onClick={() => setTab('category')} className={`min-h-12 rounded-xl border text-base font-bold ${tab === 'category' ? 'border-orange-500 bg-orange-500 text-white' : 'border-gray-200 text-gray-700'}`}>제품별</button>
          </div>
          <h3 className="mb-3 text-base font-extrabold text-gray-900">{tab === 'brand' ? '브랜드 카테고리' : '제품별 카테고리'}</h3>
          {labels.length > 0 && <nav aria-label={tab === 'brand' ? '브랜드 카테고리' : '제품별 카테고리'} className="grid grid-cols-2 gap-2">{labels.map(value => <a key={value} href={drawerHref(tab, value)} aria-label={`${value} 상품 보기`} className="flex min-h-14 items-center justify-between gap-2 rounded-xl border border-gray-200 px-3 py-3 text-base font-bold text-gray-800 hover:border-orange-400 hover:bg-orange-50"><span className="break-words">{value}</span>{tab === 'category' && <span className="shrink-0 text-sm text-orange-600">{metadata?.categoryCounts[value] ?? 0}</span>}</a>)}</nav>}
          {!loading && !error && !labels.length && <p className="rounded-xl bg-gray-50 p-4 text-sm text-gray-500">{text ? '일치하는 분류가 없습니다. 아래 상품 검색 결과를 확인해주세요.' : '등록된 분류가 없습니다.'}</p>}
          {loading && <p role="status" className="mt-4 text-sm text-gray-500">{text ? '상품을 검색하고 있습니다…' : '브랜드와 카테고리를 불러오고 있습니다…'}</p>}
          {error && <div role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-700"><p>{error}</p><button type="button" onClick={() => setRetry(value => value + 1)} className="mt-2 min-h-11 font-bold underline">다시 불러오기</button></div>}
          {!!text && !loading && !error && <section aria-label="메뉴 상품 검색 결과" className="mt-6">
            <h3 className="mb-3 text-base font-extrabold text-gray-900" aria-live="polite">상품 검색 결과 {total.toLocaleString()}개</h3>
            {products.length ? <div className="space-y-2">{products.map(product => <a key={product.id} href={`/product/${encodeURIComponent(product.id)}`} className="block rounded-xl border border-gray-200 p-3 hover:border-orange-400"><span className="block break-words text-base font-semibold text-gray-800">{product.name}</span><span className="mt-2 flex items-center justify-between gap-2"><strong className="text-orange-600">{product.livePrice.toLocaleString()}원</strong><span className="text-xs text-gray-500">상세 보기 →</span></span></a>)}</div> : <p className="rounded-xl bg-gray-50 p-4 text-sm text-gray-600">검색된 상품이 없습니다. 다른 상품명이나 브랜드로 검색해주세요.</p>}
            {total > 0 && <a href={drawerHref('search', text)} className="mt-3 block min-h-12 rounded-xl bg-orange-50 px-3 py-3 text-center font-bold text-orange-700">검색 결과 {total.toLocaleString()}개 모두 보기 →</a>}
          </section>}
        </div>
      </aside>
    </div>, document.body)}
  </>
}
