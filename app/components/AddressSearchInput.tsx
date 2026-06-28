'use client'

import { useEffect, useRef, useState } from 'react'

type DaumPostcodeData = {
  zonecode: string
  address: string
  roadAddress: string
  jibunAddress: string
  addressType: 'R' | 'J'
  bname: string
  buildingName: string
  apartment: 'Y' | 'N'
}

type DaumPostcode = {
  open: () => void
}

type DaumPostcodeConstructor = new (options: {
  oncomplete: (data: DaumPostcodeData) => void
}) => DaumPostcode

declare global {
  interface Window {
    daum?: {
      Postcode?: DaumPostcodeConstructor
    }
  }
}

type Props = {
  value: string
  onChange: (value: string) => void
  inputClassName?: string
  compact?: boolean
}

const POSTCODE_SCRIPT_ID = 'daum-postcode-script'
const POSTCODE_SCRIPT_SRC = '//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js'

function loadPostcodeScript() {
  if (typeof window === 'undefined') return Promise.reject(new Error('주소 검색을 사용할 수 없습니다.'))
  if (window.daum?.Postcode) return Promise.resolve()

  const existing = document.getElementById(POSTCODE_SCRIPT_ID) as HTMLScriptElement | null
  if (existing) {
    return new Promise<void>((resolve, reject) => {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('주소 검색 스크립트를 불러오지 못했습니다.')), { once: true })
    })
  }

  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.id = POSTCODE_SCRIPT_ID
    script.src = POSTCODE_SCRIPT_SRC
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('주소 검색 스크립트를 불러오지 못했습니다.'))
    document.head.appendChild(script)
  })
}

function formatAddress(postcode: string, baseAddress: string, detailAddress: string) {
  const prefix = postcode ? `[${postcode}] ` : ''
  const detail = detailAddress.trim()
  return `${prefix}${baseAddress.trim()}${detail ? `, ${detail}` : ''}`.trim()
}

export default function AddressSearchInput({ value, onChange, inputClassName, compact = false }: Props) {
  const [postcode, setPostcode] = useState('')
  const [baseAddress, setBaseAddress] = useState('')
  const [detailAddress, setDetailAddress] = useState('')
  const [manualAddress, setManualAddress] = useState(value)
  const [manualMode, setManualMode] = useState(Boolean(value))
  const [error, setError] = useState('')
  const detailRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!value) {
      setPostcode('')
      setBaseAddress('')
      setDetailAddress('')
      setManualAddress('')
      setManualMode(false)
      return
    }

    const parsed = value.match(/^\[(\d{5})\]\s*([^,]+)(?:,\s*(.*))?$/)
    if (parsed) {
      setPostcode(parsed[1])
      setBaseAddress(parsed[2])
      setDetailAddress(parsed[3] ?? '')
      setManualMode(false)
      return
    }

    if (!postcode && !baseAddress) {
      setManualAddress(value)
      setManualMode(true)
    }
  }, [baseAddress, postcode, value])

  async function openAddressSearch() {
    setError('')
    try {
      await loadPostcodeScript()
      const Postcode = window.daum?.Postcode
      if (!Postcode) throw new Error('주소 검색을 시작하지 못했습니다.')

      new Postcode({
        oncomplete: data => {
          const extraParts = []
          if (data.addressType === 'R' && data.bname) extraParts.push(data.bname)
          if (data.addressType === 'R' && data.buildingName && data.apartment === 'Y') {
            extraParts.push(data.buildingName)
          }

          const base = data.roadAddress || data.address || data.jibunAddress
          const addressWithExtra = extraParts.length ? `${base} (${extraParts.join(', ')})` : base

          setPostcode(data.zonecode)
          setBaseAddress(addressWithExtra)
          setDetailAddress('')
          setManualAddress('')
          setManualMode(false)
          onChange(formatAddress(data.zonecode, addressWithExtra, ''))
          window.setTimeout(() => detailRef.current?.focus(), 100)
        },
      }).open()
    } catch (e) {
      setError(e instanceof Error ? e.message : '주소 검색 중 오류가 발생했습니다.')
      setManualMode(true)
    }
  }

  function updateDetail(nextDetail: string) {
    setDetailAddress(nextDetail)
    onChange(formatAddress(postcode, baseAddress, nextDetail))
  }

  function updateManual(nextAddress: string) {
    setManualAddress(nextAddress)
    onChange(nextAddress)
  }

  const fieldClassName = inputClassName ?? 'w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent transition'
  const smallTextClass = compact ? 'text-[11px]' : 'text-xs'

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={openAddressSearch}
          className="flex-1 text-white font-black py-3 rounded-xl text-sm active:scale-95 transition-all"
          style={{ background: 'linear-gradient(135deg,#ff6a00,#e53935)' }}
        >
          주소 검색
        </button>
        <button
          type="button"
          onClick={() => {
            setManualMode(true)
            setManualAddress(value)
          }}
          className="px-4 py-3 rounded-xl text-sm font-bold border border-gray-200 text-gray-500 active:scale-95 transition-all"
        >
          직접 입력
        </button>
      </div>

      {manualMode ? (
        <textarea
          rows={2}
          value={manualAddress}
          onChange={e => updateManual(e.target.value)}
          onFocus={e => setTimeout(() => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300)}
          placeholder="주소 검색이 안 될 때만 직접 입력해 주세요"
          className={`${fieldClassName} resize-none`}
        />
      ) : (
        <div className="space-y-2">
          <input
            type="text"
            value={baseAddress ? `${postcode ? `[${postcode}] ` : ''}${baseAddress}` : ''}
            readOnly
            placeholder="주소 검색 버튼으로 도로명/지번 주소를 찾아주세요"
            className={`${fieldClassName} bg-gray-50 text-gray-700`}
          />
          <input
            ref={detailRef}
            type="text"
            value={detailAddress}
            onChange={e => updateDetail(e.target.value)}
            onFocus={e => setTimeout(() => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300)}
            placeholder="상세주소 입력 예: 101동 1203호"
            className={fieldClassName}
          />
        </div>
      )}

      <p className={`${smallTextClass} text-gray-400 leading-relaxed`}>
        도로명/지번 주소는 검색으로 선택하고, 동·호수 같은 상세주소만 직접 입력하면 배송 오류를 줄일 수 있습니다.
      </p>
      {error && <p className={`${smallTextClass} text-red-500`}>{error}</p>}
    </div>
  )
}
