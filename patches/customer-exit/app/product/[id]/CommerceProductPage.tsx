'use client'
import { customerBack } from '@/lib/customer-navigation'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import ProductPurchasePanel from '@/app/components/commerce/ProductPurchasePanel'
import { getCart, getCartCount } from '@/lib/cart-store'
import type { Product } from '@/lib/types'

type LiveProduct = Product & { isLive: boolean }

const IMAGE_URL_PATTERN = /\.(?:avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i

function isSafeUrl(value: string) {
  if (/^data:image\/(?:gif|jpeg|png|webp);base64,/i.test(value)) return true
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function renderDescription(description: string) {
  return description.split(/\r?\n/).map((line, index) => {
    const trimmed = line.trim()
    if (!trimmed) return <div key={index} className="h-2" />

    const imageMatch = trimmed.match(/^!\[([^\]]*)\]\(((?:https?:\/\/|data:image\/(?:gif|jpeg|png|webp);base64,)[^)]+)\)$/)
    if (imageMatch && isSafeUrl(imageMatch[2])) {
      return (
        <img key={index} src={imageMatch[2]} alt={imageMatch[1] || '상품 상세 이미지'} className="w-full rounded-xl object-contain" loading="lazy" />
      )
    }

    const linkMatch = trimmed.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/)
    if (linkMatch && isSafeUrl(linkMatch[2])) {
      return <a key={index} href={linkMatch[2]} target="_blank" rel="noreferrer" className="block text-orange-600 underline underline-offset-2 break-all">{linkMatch[1]}</a>
    }

    if (isSafeUrl(trimmed)) {
      if (IMAGE_URL_PATTERN.test(trimmed)) {
        return <img key={index} src={trimmed} alt="상품 상세 이미지" className="w-full rounded-xl object-contain" loading="lazy" />
      }
      return <a key={index} href={trimmed} target="_blank" rel="noreferrer" className="block text-orange-600 underline underline-offset-2 break-all">{trimmed}</a>
    }

    return <p key={index} className="text-gray-700 leading-relaxed whitespace-pre-wrap">{line}</p>
  })
}

export default function ProductDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const [product, setProduct] = useState<LiveProduct | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [cartCount, setCartCount] = useState(0)

  useEffect(() => {
    const update = () => setCartCount(getCartCount(getCart()))
    update()
    window.addEventListener('cart-updated', update)
    window.addEventListener('storage', update)
    return () => { window.removeEventListener('cart-updated', update); window.removeEventListener('storage', update) }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setLoadError(''); setProduct(null)
    fetch('/api/products/' + params.id, { cache: 'no-store', signal: controller.signal })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error ?? '상품을 불러오지 못했습니다.'); if (!controller.signal.aborted) setProduct(data) })
      .catch(error => { if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : '상품을 불러오지 못했습니다.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [params.id])

  if (loading) {
    return (
      <div className="min-h-screen-safe bg-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-full border-4 border-orange-200 border-t-orange-500 animate-spin" />
          <p className="text-sm text-gray-400">불러오는 중...</p>
        </div>
      </div>
    )
  }

  if (!product) {
    return (
      <div className="min-h-screen-safe bg-white flex flex-col items-center justify-center gap-4">
        <span className="text-6xl">😕</span>
        <p className="text-gray-500 font-semibold">{loadError || '상품을 찾을 수 없습니다.'}</p>
        <button
          onClick={() => customerBack(router)}
          className="text-orange-500 font-bold underline underline-offset-2"
        >
          ← 돌아가기
        </button>
      </div>
    )
  }

  const discountPct = product.originalPrice > 0 ? Math.round((1 - product.livePrice / product.originalPrice) * 100) : 0
  const savedAmt    = product.originalPrice - product.livePrice
  const specLines   = product.specs ? product.specs.split('\n').filter(Boolean) : []

  return (
    <div className="min-h-screen-safe bg-gray-50 flex justify-center">
      <div className="w-full max-w-[480px] bg-white min-h-screen-safe flex flex-col">

        {/* ── Header ── */}
        <header className="sticky top-0 z-20 bg-white/95 backdrop-blur-sm border-b border-gray-100 px-4 py-3 pt-[calc(0.75rem_+_env(safe-area-inset-top))] flex items-center gap-3 flex-shrink-0">
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
          <button
            onClick={() => customerBack(router)}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 transition-colors text-gray-700 font-bold text-lg flex-shrink-0"
          >
            ←
          </button>
          <h1 className="font-extrabold text-gray-900 flex-1 truncate text-sm leading-snug">
            {product.name}
          </h1>
          {product.isLive && (
            <span className="live-pulse flex-shrink-0 text-[10px] bg-red-500 text-white font-black px-2 py-1 rounded-lg">
              ● LIVE
            </span>
          )}
        </header>

        {/* ── Hero Image ── */}
        <div className="relative flex-shrink-0" style={{ height: '42vh' }}>
          {product.imageUrl ? (
            <img
              src={product.imageUrl}
              alt={product.name}
              className="w-full h-full object-contain bg-white"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-orange-50 via-amber-50 to-yellow-50 flex items-center justify-center">
              <span className="text-[100px] leading-none">🍳</span>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />

          {/* Discount badge */}
          <div className="absolute top-4 left-4">
            <span className="bg-red-500 text-white font-black text-xl px-3 py-1.5 rounded-xl shadow-lg shadow-red-900/20 block">
              {discountPct}% OFF
            </span>
          </div>
          <span className="absolute top-4 right-4 bg-gradient-to-r from-orange-500 to-red-500 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg shadow-md block">
            📺 라방 특가
          </span>

          {product.isLive && (
            <div className="absolute bottom-4 left-4">
              <span className="live-pulse bg-black/60 text-white text-xs font-bold px-3 py-1.5 rounded-xl backdrop-blur-sm block">
                ● 현재 LIVE 방송 중
              </span>
            </div>
          )}
        </div>

        {/* ── Scrollable content ── */}
        <div className="flex-1 overflow-y-auto">

          {/* Price section */}
          <div className="px-5 pt-5 pb-4 bg-white">
            <h2 className="text-base font-extrabold text-gray-900 leading-snug mb-3">
              {product.name}
            </h2>
            <div className="flex items-end gap-3 mb-2">
              <span className="text-[30px] font-black text-red-500 leading-none">
                ₩{product.livePrice.toLocaleString()}
              </span>
              <span className="text-gray-400 line-through text-base mb-0.5">
                ₩{product.originalPrice.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="bg-red-100 text-red-600 text-xs font-black px-2.5 py-1 rounded-lg">
                {discountPct}% 할인
              </span>
              <span className="text-orange-500 text-sm font-bold">
                ₩{savedAmt.toLocaleString()} 절약
              </span>
            </div>
          </div>

          <div className="h-2 bg-gray-100" />

          {/* Info grid */}
          <div className="px-5 py-4 bg-white grid grid-cols-3 gap-3">
            <div className="bg-gray-50 rounded-2xl p-3 text-center">
              <p className="text-[10px] text-gray-400 mb-1 font-medium">재고</p>
              <p className="text-base font-black text-gray-800">
                {product.quantity}<span className="text-sm font-bold">개</span>
              </p>
            </div>
            <div className="bg-orange-50 rounded-2xl p-3 text-center">
              <p className="text-[10px] text-orange-400 mb-1 font-medium">할인율</p>
              <p className="text-base font-black text-orange-500">{discountPct}%</p>
            </div>
            <div className="bg-green-50 rounded-2xl p-3 text-center">
              <p className="text-[10px] text-green-500 mb-1 font-medium">배송</p>
              <p className="text-[11px] font-black text-green-600 leading-tight">{(product.supplier?.free_shipping_threshold ?? 50000).toLocaleString()}원↑<br />무료</p>
            </div>
          </div>

          <div className="h-2 bg-gray-100" />

          {/* Specs */}
          {specLines.length > 0 && (
            <>
              <div className="px-5 py-5 bg-white">
                <h3 className="text-sm font-extrabold text-gray-800 mb-3">📋 상품 상세</h3>
                <div className="bg-gray-50 rounded-2xl p-4 space-y-2.5">
                  {specLines.map((line, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <span className="text-orange-400 mt-0.5 flex-shrink-0 font-bold">•</span>
                      <span className="text-gray-700 leading-relaxed">{line}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="h-2 bg-gray-100" />
            </>
          )}

          {product.description?.trim() && (
            <>
              <div className="px-5 py-5 bg-white">
                <h3 className="text-sm font-extrabold text-gray-800 mb-3">상품 상세 설명</h3>
                <div className="space-y-3 text-sm overflow-hidden">
                  {renderDescription(product.description)}
                </div>
              </div>
              <div className="h-2 bg-gray-100" />
            </>
          )}

          {/* Benefits */}
          <div className="px-5 py-5 bg-white">
            <h3 className="text-sm font-extrabold text-gray-800 mb-3">✨ 구매 혜택</h3>
            <div className="space-y-2">
              {[
                '🚚 오늘 주문 시 내일 도착',
                product.supplier ? '🚚 같은 출고지 ' + product.supplier.free_shipping_threshold.toLocaleString() + '원 이상 무료배송' : '🚚 5만원 이상 구매시 무료배송',
                '🔄 7일 이내 무료 반품',
                '🎁 라이브 단독 특가',
              ].map(b => (
                <div
                  key={b}
                  className="flex items-center gap-2 text-sm text-gray-600 bg-gray-50 rounded-xl px-4 py-2.5 font-medium"
                >
                  {b}
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-xl border border-orange-100 bg-orange-50 px-4 py-3 text-xs leading-relaxed text-gray-700">
              <a href="/policy/refund" className="font-bold text-orange-700 hover:text-orange-800 transition-colors">환불/교환 안내</a>
              에서 반품 기준과 절차를 확인할 수 있습니다.
            </div>
          </div>

          <div className="h-4" />
        </div>

        <ProductPurchasePanel key={product.id} product={product} onAdded={() => setCartCount(getCartCount(getCart()))} />

      </div>
    </div>
  )
}
