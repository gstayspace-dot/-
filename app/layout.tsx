import type { Metadata, Viewport } from 'next'
import './globals.css'
import OrderAlertGlobal from './components/OrderAlertGlobal'

export const metadata: Metadata = {
  title: '영진상사 라이브쇼핑',
  description: '라이브 방송 한정 특가! 매일 새로운 상품을 만나보세요.',
  openGraph: {
    title: '영진상사 라이브쇼핑',
    description: '라이브 방송 한정 특가! 매일 새로운 상품을 만나보세요.',
    type: 'website',
  },
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
