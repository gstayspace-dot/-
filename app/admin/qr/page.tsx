'use client'

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

export default function AdminQrPage() {
  const [url, setUrl] = useState('')
  const [dataUrl, setDataUrl] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const origin = window.location.origin
    const liveUrl = `${origin}/living-live`
    setUrl(liveUrl)
    QRCode.toDataURL(liveUrl, {
      width: 720,
      margin: 2,
      color: { dark: '#111111', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    }).then(setDataUrl).catch(() => {})
  }, [])

  async function copyLink() {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url)
      } else {
        // 클립보드 API 미지원 환경(일부 모바일/인앱 브라우저) 폴백
        const ta = document.createElement('textarea')
        ta.value = url
        ta.style.position = 'fixed'
        ta.style.left = '-9999px'
        document.body.appendChild(ta)
        ta.focus(); ta.select()
        document.execCommand('copy')
        ta.remove()
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      window.prompt('아래 링크를 길게 눌러 복사하세요', url)
    }
  }

  async function downloadQr() {
    if (!dataUrl) return
    try {
      // 데이터 URL을 Blob URL로 변환 — 모바일에서도 안정적으로 저장됨
      const res = await fetch(dataUrl)
      const blob = await res.blob()
      const objUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objUrl
      a.download = '영진상사-쇼핑몰-QR.png'
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(objUrl), 1000)
    } catch {
      // 저장이 막힌 환경: 새 탭으로 열어 길게 눌러 저장하도록 안내
      window.open(dataUrl, '_blank')
    }
  }

  return (
    <div className="min-h-screen-safe bg-gray-50">
      {/* ── Nav ── */}
      <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="text-xl font-black text-gray-900">🛠 관리자</span>
          <span className="text-gray-300">|</span>
          <span className="text-sm text-gray-600 font-semibold">QR 코드</span>
        </div>
        <div className="flex items-center gap-4">
          <a href="/admin/products" className="text-sm text-gray-500 hover:text-gray-700 font-medium transition-colors">📦 상품</a>
          <a href="/admin/orders" className="text-sm text-gray-500 hover:text-gray-700 font-medium transition-colors">📋 주문</a>
          <a href="/admin/chat" className="text-sm text-gray-500 hover:text-gray-700 font-medium transition-colors">💬 채팅</a>
          <a href="/living-live" target="_blank" rel="noopener noreferrer" className="text-sm text-orange-500 hover:text-orange-600 font-semibold transition-colors">📺 라이브 →</a>
        </div>
      </nav>

      <div className="max-w-md mx-auto px-4 py-8">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 flex flex-col items-center gap-5">
          <div className="text-center">
            <p className="text-lg font-extrabold text-gray-900">고객용 쇼핑몰 QR</p>
            <p className="text-sm text-gray-500 mt-1">라이브 방송 화면에 띄우거나 인쇄해 사용하세요.<br />스캔하면 고객이 쇼핑몰로 바로 이동합니다.</p>
          </div>

          <div className="bg-white rounded-3xl border-2 border-gray-200 shadow-lg p-5">
            {dataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={dataUrl} alt="QR 코드" className="w-64 h-64" />
            ) : (
              <div className="w-64 h-64 flex items-center justify-center">
                <div className="w-10 h-10 rounded-full border-4 border-orange-200 border-t-orange-500 animate-spin" />
              </div>
            )}
          </div>

          <div className="w-full text-center">
            <p className="text-xs text-gray-400 mb-1">연결 링크</p>
            <p className="text-sm font-bold text-gray-700 break-all">{url}</p>
          </div>

          <div className="w-full flex flex-col gap-2.5">
            <button
              onClick={copyLink}
              className="w-full bg-white border-2 border-gray-200 text-gray-700 font-black py-3.5 rounded-2xl text-sm active:scale-95 transition-all hover:border-gray-300"
            >
              {copied ? '✓ 복사됨!' : '🔗 링크 복사'}
            </button>
            <button
              onClick={downloadQr}
              disabled={!dataUrl}
              className="w-full text-center text-white font-black py-3.5 rounded-2xl text-sm shadow-lg active:scale-95 transition-all disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg,#ff6a00,#e53935)' }}
            >
              ⬇ QR 이미지 저장
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
