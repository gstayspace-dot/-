import type { Metadata, Viewport } from 'next'
import './globals.css'
import OrderAlertGlobal from './components/OrderAlertGlobal'

export const metadata: Metadata = {
  title: '🔴 LIVE | 스테인리스 프리미엄 냄비 세트 5종 - 오늘만 60% 할인!',
  description: '라이브 방송 한정 특가! 스테인리스 프리미엄 냄비 세트 5종 오늘만 60% 할인. 남은 수량 15개!',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko">
      <head>
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body className="antialiased">
        {children}
        <OrderAlertGlobal />
      </body>
    </html>
  )
}
