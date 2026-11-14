import type { Metadata, Viewport } from 'next'
import './globals.css'
import OrderAlertGlobal from './components/OrderAlertGlobal'

export const metadata: Metadata = {
  title: '리빙라방 | 주방·생활용품 라이브쇼핑',
  description: '리빙라방에서 주방·생활용품과 라이브 방송 특가 상품을 만나보세요. 상품 정보와 주문을 간편하게 확인하세요.',
  openGraph: {
    title: '리빙라방 | 주방·생활용품 라이브쇼핑',
    description: '리빙라방에서 주방·생활용품과 라이브 방송 특가 상품을 만나보세요. 상품 정보와 주문을 간편하게 확인하세요.',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: '리빙라방 | 주방·생활용품 라이브쇼핑',
    description: '리빙라방에서 주방·생활용품과 라이브 방송 특가 상품을 만나보세요. 상품 정보와 주문을 간편하게 확인하세요.',
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
