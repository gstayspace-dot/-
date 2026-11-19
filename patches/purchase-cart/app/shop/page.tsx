'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, rowToProduct, compareProducts, type DbProduct } from '@/lib/supabaseClient'
import { addToCart, getCart, getCartCount } from '@/lib/cart-store'
import type { Product } from '@/lib/types'

type LiveProduct = Product & { isLive: boolean }
type ProductGroup = 'all' | 'live' | 'general'
type ProductListResponse = {
  products?: LiveProduct[]
  total?: number
  limit?: number
  offset?: number
  nextOffset?: number
  hasMore?: boolean
}

const PRODUCT_EMOJIS = ['🍳', '🥘', '🫕', '🥄', '🔪', '🥗']
const PRODUCT_PAGE_SIZE = 20

function readInitialProductGroup(): ProductGroup {
  if (typeof window === 'undefined') return 'all'
  const group = new URLSearchParams(window.location.search).get('group')
  if (group === 'live') return 'live'
  if (group === 'general') return 'general'
  return 'all'
}

function readInitialDirectGroupView() {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  return params.get('group') === 'live' && params.get('view') === 'live'
}

function productMatchesGroup(product: LiveProduct, group: ProductGroup) {
  if (!product.isVisible) return false
  if (group === 'live') return product.isLive
  if (group === 'general') return !product.isLive
  return true
}

function groupTitle(group: ProductGroup) {
  if (group === 'live') return 'LIVE 송출상품'
  if (group === 'general') return '일반상품'
  return '전체 상품'
}

async function fetchWithRetry(input: string, init?: RequestInit) {
  const first = await fetch(input, init)
  if (first.ok) return first

  await new Promise(resolve => setTimeout(resolve, 350))
  return fetch(input, init)
}

export default function ShopPage() {
  const router = useRouter()
  const [products, setProducts] = useState<LiveProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [productTotal, setProductTotal] = useState(0)
  const [productNextOffset, setProductNextOffset] = useState(0)
  const [hasMoreProducts, setHasMoreProducts] = useState(false)
  const [cartCount, setCartCount] = useState(0)
  const [addedId, setAddedId] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(() => (
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('focus')
  ))
  const [productGroup, setProductGroup] = useState<ProductGroup>(readInitialProductGroup)
  const [isDirectGroupView, setIsDirectGroupView] = useState(readInitialDirectGroupView)
  const [brandFilter, setBrandFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')

  useEffect(() => { setCartCount(getCartCount(getCart())) }, [addedId])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const urlGroup = params.get('group') === 'live'
      ? 'live'
      : params.get('group') === 'general'
        ? 'general'
        : 'all'
    setProductGroup(prev => prev === urlGroup ? prev : urlGroup)
    setIsDirectGroupView(urlGroup === 'live' && params.get('view') === 'live')
  }, [])

  const fetchProducts = useCallback(async (offset = 0, append = false) => {
    if (append) setLoadingMore(true)
    else setLoading(true)
    try {
      const params = new URLSearchParams({
        listOnly: 'true',
        paged: 'true',
        limit: String(PRODUCT_PAGE_SIZE),
        offset: String(offset),
        fresh: String(Date.now()),
      })
      if (productGroup !== 'all') params.set('group', productGroup)
      const res = await fetchWithRetry(`/api/products?${params.toString()}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('products request failed')
      const payload = await res.json() as ProductListResponse | LiveProduct[]
      const nextProducts = Array.isArray(payload) ? payload : payload.products ?? []
      const total = Array.isArray(payload) ? offset + nextProducts.length : payload.total ?? offset + nextProducts.length
      const nextOffset = Array.isArray(payload) ? offset + nextProducts.length : payload.nextOffset ?? offset + PRODUCT_PAGE_SIZE
      setProducts(prev => {
        if (!append) return nextProducts
        const existingIds = new Set(prev.map(product => product.id))
        return [...prev, ...nextProducts.filter(product => !existingIds.has(product.id))]
      })
      setProductTotal(total)
      setProductNextOffset(nextOffset)
      setHasMoreProducts(Array.isArray(payload) ? nextOffset < total : payload.hasMore ?? nextOffset < total)
    } catch {
      if (!append) {
        setProducts([])
        setProductTotal(0)
        setProductNextOffset(0)
        setHasMoreProducts(false)
      }
    } finally {
      if (append) setLoadingMore(false)
      else setLoading(false)
    }
  }, [productGroup])

  useEffect(() => {
    fetchProducts()

    if (process.env.NEXT_PUBLIC_ENABLE_PRODUCT_REALTIME === 'true') {
      const channel = supabase
      .channel('products-shop-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const inserted = rowToProduct(payload.new as DbProduct)
          if (productMatchesGroup(inserted, productGroup)) setProducts(prev => [inserted, ...prev].sort(compareProducts))
        } else if (payload.eventType === 'UPDATE') {
          const u = rowToProduct(payload.new as DbProduct)
          setProducts(prev => (
            productMatchesGroup(u, productGroup)
              ? prev.some(p => p.id === u.id)
                ? prev.map(p => p.id === u.id ? u : p).sort(compareProducts)
                : [u, ...prev].sort(compareProducts)
              : prev.filter(p => p.id !== u.id)
          ))
        } else if (payload.eventType === 'DELETE') {
          const id = (payload.old as { id: string }).id
          setProducts(prev => prev.filter(p => p.id !== id))
        }
      })
      .subscribe()

      return () => { supabase.removeChannel(channel) }
    }
  }, [fetchProducts, productGroup])

  const focused = focusId ? products.find(p => p.id === focusId) ?? null : null
  const brands = Array.from(new Set(products.map(product => product.brand).filter(Boolean))).sort()
  const categories = Array.from(new Set(products.map(product => product.category).filter(Boolean))).sort()
  const filteredProducts = products.filter(product =>
    (!brandFilter || product.brand === brandFilter) &&
    (!categoryFilter || product.category === categoryFilter)
  )
  const liveProducts = productGroup === 'general' ? [] : filteredProducts.filter(p => p.isLive && p.id !== focusId)
  const normalProducts = productGroup === 'live' ? [] : filteredProducts.filter(p => !p.isLive && p.id !== focusId)

  function handleProductGroupChange(group: ProductGroup) {
    if (group === productGroup) return
    setProductGroup(group)
    setIsDirectGroupView(false)
    setFocusId(null)
    setBrandFilter('')
    setCategoryFilter('')
    router.replace(group === 'all' ? '/shop' : `/shop?group=${group}`)
  }

  function loadMoreProducts() {
    if (loading || loadingMore || !hasMoreProducts) return
    fetchProducts(productNextOffset, true)
  }

  function quickAdd(p: LiveProduct) {
    if (p.purchaseConfig?.variants.length || p.purchaseConfig?.addons.length) { router.push('/product/' + p.id); return }
    addToCart({ productId: p.id, productName: p.name, price: p.livePrice, imageUrl: p.imageUrl ?? '' })
    setAddedId(p.id)
    setTimeout(() => setAddedId(prev => prev === p.id ? null : prev), 1500)
  }

  function orderNow(p: LiveProduct) {
    if (p.purchaseConfig?.variants.length || p.purchaseConfig?.addons.length) { router.push('/product/' + p.id); return }
    if (!getCart().some(item => !item.commerceVersion && item.productId === p.id)) {
      addToCart({ productId: p.id, productName: p.name, price: p.livePrice, imageUrl: p.imageUrl ?? '' })
    }
    router.push('/cart')
  }

  function ProductCard({ product, idx, live }: { product: LiveProduct; idx: number; live: boolean }) {
    const disc = Math.round((1 - product.livePrice / product.originalPrice) * 100)
    const emoji = PRODUCT_EMOJIS[idx % PRODUCT_EMOJIS.length]
    const added = addedId === product.id
    return (
      <div className="rounded-2xl overflow-hidden border-2 border-gray-200 bg-white flex flex-col">
        <button
          onClick={() => router.push(`/product/${product.id}`)}
          className="relative h-32 bg-gray-50 flex items-center justify-center overflow-hidden active:opacity-90"
        >
          {product.imageUrl
            ? <img src={product.imageUrl} alt={product.name} loading="lazy" className="w-full h-full object-contain bg-white" />
            : <span className="text-5xl">{emoji}</span>}
          {live && (
            <span className="live-pulse absolute top-1.5 left-1.5 text-[9px] bg-red-500 text-white px-1.5 py-0.5 rounded font-black">
              ● LIVE
            </span>
          )}
          {disc > 0 && (
            <span className="absolute top-1.5 right-1.5 text-[10px] bg-black/70 text-white px-1.5 py-0.5 rounded font-black">
              -{disc}%
            </span>
          )}
        </button>

        <div className="px-2.5 py-2 flex flex-col flex-1">
          <button onClick={() => router.push(`/product/${product.id}`)} className="text-left">
            <p className="text-[12px] font-bold text-gray-800 leading-tight line-clamp-2 min-h-[30px]">
              {product.name}
            </p>
          </button>
          {product.brand && (
            <p className="mt-1 text-[10px] font-bold text-orange-600 truncate">{product.brand}</p>
          )}
          <div className="flex items-end gap-1.5 mt-1">
            <span className="text-[14px] font-black text-red-500">₩{product.livePrice.toLocaleString()}</span>
            {disc > 0 && (
              <span className="text-[10px] text-gray-400 line-through mb-0.5">₩{product.originalPrice.toLocaleString()}</span>
            )}
          </div>
          <button
            onClick={() => quickAdd(product)}
            className={`mt-2 w-full py-2 rounded-xl text-[12px] font-black active:scale-95 transition-all border-2 ${
              added
                ? 'bg-green-50 border-green-400 text-green-600'
                : 'bg-white border-orange-300 text-orange-500 hover:bg-orange-50'
            }`}
          >
            {added ? '✓ 담겼어요!' : '🛒 담기'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen-safe bg-gray-50 flex justify-center">
      <div className="w-full max-w-[480px] bg-white min-h-screen-safe flex flex-col">

        {/* ── Header ── */}
        <header className="sticky top-0 z-20 bg-white/95 backdrop-blur-sm border-b border-gray-100 px-4 py-3 pt-[calc(0.75rem_+_env(safe-area-inset-top))] flex items-center gap-3 flex-shrink-0">
          <button
            onClick={() => router.push('/living-live')}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 transition-colors text-gray-700 font-bold text-lg flex-shrink-0"
          >
            ←
          </button>
          <h1 className="font-extrabold text-gray-900 flex-1 text-base">🛍 {groupTitle(productGroup)}</h1>
          <button
            onClick={() => router.push('/cart')}
            className="relative w-9 h-9 flex items-center justify-center flex-shrink-0"
            aria-label="장바구니"
          >
            <span className="text-xl">🛒</span>
            {cartCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center leading-none">
                {cartCount > 9 ? '9+' : cartCount}
              </span>
            )}
          </button>
        </header>

        <div className="flex-1 overflow-y-auto pb-28">
          {loading ? (
            <div className="flex items-center justify-center py-24">
              <div className="w-10 h-10 rounded-full border-4 border-orange-200 border-t-orange-500 animate-spin" />
            </div>
          ) : products.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 gap-3 text-gray-400">
              <span className="text-5xl">📭</span>
              <p className="font-semibold">등록된 상품이 없습니다.</p>
            </div>
          ) : (
            <>
              {!isDirectGroupView && (
                <div className="grid grid-cols-3 gap-2 px-4 pt-4">
                  {(['all', 'live', 'general'] as ProductGroup[]).map(group => (
                    <button
                      key={group}
                      type="button"
                      onClick={() => handleProductGroupChange(group)}
                      className={`rounded-xl border px-2 py-2.5 text-xs font-black transition-colors ${
                        productGroup === group
                          ? group === 'live'
                            ? 'border-red-400 bg-red-50 text-red-600'
                            : 'border-orange-400 bg-orange-50 text-orange-600'
                          : 'border-gray-200 bg-white text-gray-500'
                      }`}
                    >
                      {group === 'all' ? '전체' : group === 'live' ? 'LIVE' : '일반'}
                    </button>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 px-4 pt-4">
                <select
                  value={brandFilter}
                  onChange={(e) => setBrandFilter(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
                  aria-label="브랜드 선택"
                >
                  <option value="">전체 브랜드</option>
                  {brands.map(brand => <option key={brand} value={brand}>{brand}</option>)}
                </select>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
                  aria-label="카테고리 선택"
                >
                  <option value="">전체 카테고리</option>
                  {categories.map(category => <option key={category} value={category}>{category}</option>)}
                </select>
              </div>

              {/* 선택한 상품 (메인에서 눌러 넘어온 상품) 상단 노출 */}
              {focused && (
                <section className="px-4 pt-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-base">👀</span>
                    <h2 className="text-sm font-extrabold text-gray-800">선택하신 상품</h2>
                  </div>
                  <div className="rounded-2xl overflow-hidden border-2 border-orange-300 shadow-md shadow-orange-100 bg-white flex">
                    <button
                      onClick={() => router.push(`/product/${focused.id}`)}
                      className="relative w-32 flex-shrink-0 bg-gray-50 flex items-center justify-center overflow-hidden active:opacity-90"
                    >
                      {focused.imageUrl
                        ? <img src={focused.imageUrl} alt={focused.name} className="w-full h-full object-contain bg-white" />
                        : <span className="text-5xl">🛍</span>}
                      {focused.isLive && (
                        <span className="live-pulse absolute top-1.5 left-1.5 text-[9px] bg-red-500 text-white px-1.5 py-0.5 rounded font-black">● LIVE</span>
                      )}
                    </button>
                    <div className="flex-1 px-3 py-3 flex flex-col min-w-0">
                      <button onClick={() => router.push(`/product/${focused.id}`)} className="text-left">
                        <p className="text-sm font-bold text-gray-900 leading-tight line-clamp-2">{focused.name}</p>
                      </button>
                      {focused.brand && (
                        <p className="mt-1 text-[11px] font-bold text-orange-600 truncate">{focused.brand}</p>
                      )}
                      <div className="flex items-end gap-2 mt-1.5">
                        <span className="text-lg font-black text-red-500">₩{focused.livePrice.toLocaleString()}</span>
                        {focused.originalPrice > focused.livePrice && (
                          <span className="text-xs text-gray-400 line-through mb-0.5">₩{focused.originalPrice.toLocaleString()}</span>
                        )}
                      </div>
                      <div className="flex gap-2 mt-auto pt-2">
                        <button
                          onClick={() => quickAdd(focused)}
                          className={`flex-1 py-2 rounded-xl text-[12px] font-black active:scale-95 transition-all border-2 ${
                            addedId === focused.id
                              ? 'bg-green-50 border-green-400 text-green-600'
                              : 'bg-white border-orange-300 text-orange-500 hover:bg-orange-50'
                          }`}
                        >
                          {addedId === focused.id ? '✓ 담겼어요!' : '🛒 담기'}
                        </button>
                        <button
                          onClick={() => orderNow(focused)}
                          className="flex-1 py-2 rounded-xl text-[12px] font-black text-white active:scale-95 transition-all shadow"
                          style={{ background: 'linear-gradient(135deg,#ff6a00,#e53935)' }}
                        >
                          바로 주문
                        </button>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {/* 라이브 상품 */}
              {liveProducts.length > 0 && (
                <section className="px-4 pt-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="live-pulse bg-red-500 text-white text-[11px] font-black px-2 py-0.5 rounded">● LIVE</span>
                    <h2 className="text-sm font-extrabold text-gray-800">라이브 방송 상품</h2>
                    <span className="text-[11px] text-gray-400">{liveProducts.length}개</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {liveProducts.map((p, i) => <ProductCard key={p.id} product={p} idx={i} live />)}
                  </div>
                </section>
              )}

              {/* 일반 상품 */}
              {normalProducts.length > 0 && (
                <section className="px-4 pt-6">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-base">🛒</span>
                    <h2 className="text-sm font-extrabold text-gray-800">일반 등록 상품</h2>
                    <span className="text-[11px] text-gray-400">{normalProducts.length}개</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {normalProducts.map((p, i) => <ProductCard key={p.id} product={p} idx={i} live={false} />)}
                  </div>
                </section>
              )}

              {filteredProducts.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 gap-3 text-gray-400">
                  <span className="text-5xl">📭</span>
                  <p className="font-semibold">상품이 없습니다.</p>
                </div>
              )}

              {hasMoreProducts && (
                <div className="px-4 pt-6">
                  <button
                    type="button"
                    onClick={loadMoreProducts}
                    disabled={loadingMore}
                    className="w-full rounded-2xl border-2 border-orange-200 bg-white py-3 text-sm font-black text-orange-600 active:scale-95 transition-all disabled:opacity-50"
                  >
                    {loadingMore ? '불러오는 중...' : `더보기 (${products.length}/${productTotal})`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Sticky CTA: 구매 유도 ── */}
        <div className="fixed bottom-0 w-full max-w-[480px] bg-white border-t border-gray-100 px-4 py-3 pb-[calc(0.75rem_+_env(safe-area-inset-bottom))] flex gap-2 z-20">
          <button
            onClick={() => router.push('/living-live?chat=1')}
            className="flex-1 bg-white border-2 border-gray-200 text-gray-700 font-black py-3.5 rounded-2xl text-sm active:scale-95 transition-all hover:border-gray-300"
          >
            💬 채팅 상담
          </button>
          <button
            onClick={() => router.push('/cart')}
            className="flex-1 text-white font-black py-3.5 rounded-2xl text-sm shadow-lg active:scale-95 transition-all"
            style={{ background: 'linear-gradient(135deg,#ff6a00,#e53935)' }}
          >
            🛒 장바구니 / 주문
          </button>
        </div>

      </div>
    </div>
  )
}
