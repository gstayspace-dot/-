'use client'
import { useEffect, useState } from 'react'
import { useLiveCurrent } from '@/lib/use-live-current'
import { priceError, won, type LiveProduct } from '@/lib/live-overlay'
import './overlay.css'

function Graphic({ product: p }: { product: LiveProduct }) {
  const [imageFailed, setImageFailed] = useState(false)
  return <div className="live-cycle"><section className="live-banner" aria-label="라이브 특가 상품">
    <div className="live-photo">{p.image_url && !imageFailed ? <img src={p.image_url} alt={p.name} onError={() => setImageFailed(true)} /> : <span>이미지 준비 중</span>}</div>
    <div className="live-details"><span className="live-badge">LIVE SPECIAL</span><h1>{p.name}</h1><div className="live-prices"><s>{won(p.original_price)}</s><strong>{won(p.sale_price)}</strong></div></div>
    <div className="live-saving"><b>{p.discount_percent}<small>%</small></b><span>할인</span><strong>{won(p.discount_amount)} 절약</strong></div>
  </section></div>
}
export default function Overlay() {
  const { current } = useLiveCurrent()
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const number = (key: string) => Math.min(2000, Math.max(0, Number(params.get(key)) || 0))
    const next = { x: number('x'), y: number('y') }
    setOffset(next)
    const resize = () => setScale(Math.max(0, Math.min(1, (window.innerWidth - next.x) / 1080, (window.innerHeight - next.y) / 300)))
    resize(); window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  const p = current?.product
  const valid = current?.visible && p && !p.error && !priceError(p.original_price, p.sale_price)
  return <main className="live-overlay" style={{ left: offset.x, top: offset.y, transform: `scale(${scale})` }}>
    {valid && <Graphic key={`${p.id}:${current.revision}:${p.image_url}`} product={p} />}
  </main>
}
