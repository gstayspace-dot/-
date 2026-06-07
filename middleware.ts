import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const VALID_TOKENS = new Set(['tlc_admin_v1', 'tlc_admin_super_v1'])

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (pathname === '/admin/login') return NextResponse.next()

  if (pathname.startsWith('/admin')) {
    const token = request.cookies.get('admin_token')
    if (!token || !VALID_TOKENS.has(token.value)) {
      const url = new URL('/admin/login', request.url)
      url.searchParams.set('from', pathname)
      return NextResponse.redirect(url)
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*'],
}
