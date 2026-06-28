import { NextRequest, NextResponse } from 'next/server'

type NaverAddress = {
  roadAddress?: string
  jibunAddress?: string
}

type NaverGeocodeResponse = {
  addresses?: NaverAddress[]
  errorMessage?: string
}

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get('q')?.trim() ?? ''

  if (query.length < 2) {
    return NextResponse.json({ results: [] })
  }

  const keyId = process.env.NAVER_MAPS_CLIENT_ID ?? process.env.NAVER_MAPS_API_KEY_ID
  const key = process.env.NAVER_MAPS_CLIENT_SECRET ?? process.env.NAVER_MAPS_API_KEY

  if (!keyId || !key) {
    return NextResponse.json(
      { message: '네이버 주소검색 API 키가 설정되지 않았습니다.' },
      { status: 500 },
    )
  }

  const url = new URL('https://maps.apigw.ntruss.com/map-geocode/v2/geocode')
  url.searchParams.set('query', query)
  url.searchParams.set('count', '10')

  try {
    const res = await fetch(url, {
      headers: {
        'X-NCP-APIGW-API-KEY-ID': keyId,
        'X-NCP-APIGW-API-KEY': key,
      },
      cache: 'no-store',
    })

    const body = await res.json() as NaverGeocodeResponse

    if (!res.ok) {
      return NextResponse.json(
        { message: body.errorMessage ?? '네이버 주소검색 요청에 실패했습니다.' },
        { status: res.status },
      )
    }

    const results = (body.addresses ?? [])
      .map(address => {
        const roadAddress = address.roadAddress ?? ''
        const jibunAddress = address.jibunAddress ?? ''
        const displayAddress = roadAddress || jibunAddress

        return { roadAddress, jibunAddress, displayAddress }
      })
      .filter(address => address.displayAddress)

    return NextResponse.json({ results })
  } catch {
    return NextResponse.json(
      { message: '네이버 주소검색 서버에 연결하지 못했습니다.' },
      { status: 502 },
    )
  }
}
