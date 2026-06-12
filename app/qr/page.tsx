'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import QRCode from 'qrcode'

export default function QrPage() {
  const router = useRouter()
  const [url, setUrl] = useState('')
  const [dataUrl, setDataUrl] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const origin = window.location.origin
    setUrl(origin)
    QRCode.toDataURL(origin, {
      width: 720,
      margin: 2,
      color: { dark: '#111111', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    }).then(setDataUrl).catch(() => {})
  }, [])

  function copyLink() {
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="min-h-screen-safe bg-gray-50 flex justify-center">
      <div className="w-full max-w-[480px] bg-white min-h-screen-safe flex flex-col">

        <header className="sticky top-0 z-20 bg-white/95 backdrop-blur-sm border-b border-gray-100 px-4 py-3 pt-[calc(0.75rem_+_env(safe-area-inset-top))] flex items-center gap-3 flex-shrink-0">
          <button
            onClick={() => router.push('/')}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 transition-colors text-gray-700 font-bold text-lg flex-shrink-0"
          >
            ←
          </button>
          <h1 className="font-extrabold text-gray-900 flex-1 text-base">📱 QR 코드</h1>
        </header>

        <div className="flex-1 flex flex-col items-center justify-center px-6 py-8 gap-6">
          <div className="text-center">
            <p className="text-lg font-extrabold text-gray-900">라이브쇼핑 바로가기</p>
            <p className="text-sm text-gray-500 mt-1">QR을 스캔하면 쇼핑몰로 바로 이동합니다</p>
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

          <div className="w-full max-w-xs text-center">
            <p className="text-xs text-gray-400 mb-1">링크</p>
            <p className="text-sm font-bold text-gray-700 break-all">{url}</p>
          </div>

          <div className="w-full max-w-xs flex flex-col gap-2.5">
            <button
              onClick={copyLink}
              className="w-full bg-white border-2 border-gray-200 text-gray-700 font-black py-3.5 rounded-2xl text-sm active:scale-95 transition-all hover:border-gray-300"
            >
              {copied ? '✓ 복사됨!' : '🔗 링크 복사'}
            </button>
            {dataUrl && (
              <a
                href={dataUrl}
                download="라이브쇼핑-QR.png"
                className="w-full text-center text-white font-black py-3.5 rounded-2xl text-sm shadow-lg active:scale-95 transition-all"
                style={{ background: 'linear-gradient(135deg,#ff6a00,#e53935)' }}
              >
                ⬇ QR 이미지 저장
              </a>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
