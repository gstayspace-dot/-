import { NextRequest, NextResponse } from 'next/server'

type JusoAddress = {
  roadAddr?: string
  roadAddrPart1?: string
  roadAddrPart2?: string
  jibunAddr?: string
  zipNo?: string
}

type JusoSearchResponse = {
  results?: {
    common?: {
      errorCode?: string
      errorMessage?: string
    }
    juso?: JusoAddress[]
  }
}

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get('q')?.trim() ?? ''

  if (query.length < 2) {
    return NextResponse.json({ results: [] })
  }

  const key = process.env.JUSO_API_KEY ?? process.env.ROAD_ADDRESS_API_KEY ?? 'TESTJUSOGOKR'

  const url = new URL('https://business.juso.go.kr/addrlink/addrLinkApi.do')
  url.searchParams.set('confmKey', key)
  url.searchParams.set('currentPage', '1')
  url.searchParams.set('countPerPage', '10')
  url.searchParams.set('keyword', query)
  url.searchParams.set('resultType', 'json')

  try {
    const res = await fetch(url, { cache: 'no-store' })
    const body = await res.json() as JusoSearchResponse
    const errorCode = body.results?.common?.errorCode ?? ''
    const errorMessage = body.results?.common?.errorMessage ?? ''

    if (!res.ok || errorCode !== '0') {
      return NextResponse.json(
        { message: errorMessage || '도로명주소 검색 요청에 실패했습니다.' },
        { status: res.ok ? 400 : res.status },
      )
    }

    const results = (body.results?.juso ?? [])
      .map(address => {
        const roadAddress = address.roadAddrPart1 || address.roadAddr || ''
        const extraAddress = address.roadAddrPart2 ?? ''
        const jibunAddress = address.jibunAddr ?? ''
        const zipNo = address.zipNo ?? ''
        const displayAddress = roadAddress || address.roadAddr || jibunAddress

        return { roadAddress, extraAddress, jibunAddress, zipNo, displayAddress }
      })
      .filter(address => address.displayAddress)

    return NextResponse.json({ results })
  } catch {
    return NextResponse.json(
      { message: '도로명주소 검색 서버에 연결하지 못했습니다.' },
      { status: 502 },
    )
  }
}
