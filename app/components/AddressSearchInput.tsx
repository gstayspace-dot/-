'use client'

import { FormEvent, useEffect, useRef, useState } from 'react'

type AddressResult = {
  roadAddress: string
  jibunAddress: string
  displayAddress: string
}

type Props = {
  value: string
  onChange: (value: string) => void
  inputClassName?: string
  compact?: boolean
}

function formatAddress(baseAddress: string, detailAddress: string) {
  const detail = detailAddress.trim()
  return `${baseAddress.trim()}${detail ? `, ${detail}` : ''}`.trim()
}

function parseSavedAddress(value: string) {
  const withoutPostcode = value.replace(/^\[\d{5}\]\s*/, '')
  const [base = '', ...detailParts] = withoutPostcode.split(', ')
  return {
    baseAddress: base,
    detailAddress: detailParts.join(', '),
  }
}

export default function AddressSearchInput({ value, onChange, inputClassName, compact = false }: Props) {
  const parsedValue = parseSavedAddress(value)
  const [baseAddress, setBaseAddress] = useState('')
  const [detailAddress, setDetailAddress] = useState('')
  const [manualAddress, setManualAddress] = useState(value)
  const [manualMode, setManualMode] = useState(Boolean(value))
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState(parsedValue.baseAddress)
  const [searchResults, setSearchResults] = useState<AddressResult[]>([])
  const [hasSearched, setHasSearched] = useState(false)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const detailRef = useRef<HTMLInputElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!value) {
      setBaseAddress('')
      setDetailAddress('')
      setManualAddress('')
      setManualMode(false)
      return
    }

    if (!baseAddress) {
      const parsed = parseSavedAddress(value)
      setBaseAddress(parsed.baseAddress)
      setDetailAddress(parsed.detailAddress)
      setManualAddress(value)
      setSearchQuery(parsed.baseAddress)
      setManualMode(false)
    }
  }, [baseAddress, value])

  useEffect(() => {
    if (!searchOpen) return
    window.setTimeout(() => searchInputRef.current?.focus(), 80)
  }, [searchOpen])

  async function searchAddress(e?: FormEvent) {
    e?.preventDefault()

    const query = searchQuery.trim()
    if (query.length < 2) {
      setError('주소를 두 글자 이상 입력해 주세요.')
      return
    }

    setSearching(true)
    setHasSearched(false)
    setError('')

    try {
      const res = await fetch(`/api/address/search?q=${encodeURIComponent(query)}`)
      const body = await res.json() as { results?: AddressResult[]; message?: string }

      if (!res.ok) throw new Error(body.message ?? '주소 검색 중 오류가 발생했습니다.')

      setSearchResults(body.results ?? [])
      setHasSearched(true)
    } catch (err) {
      setSearchResults([])
      setHasSearched(true)
      setError(err instanceof Error ? err.message : '주소 검색 중 오류가 발생했습니다.')
    } finally {
      setSearching(false)
    }
  }

  function selectAddress(result: AddressResult) {
    const nextBaseAddress = result.roadAddress || result.jibunAddress || result.displayAddress
    setBaseAddress(nextBaseAddress)
    setDetailAddress('')
    setManualAddress('')
    setManualMode(false)
    setSearchOpen(false)
    onChange(formatAddress(nextBaseAddress, ''))

    window.setTimeout(() => {
      detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      detailRef.current?.focus()
    }, 120)
  }

  function updateDetail(nextDetail: string) {
    setDetailAddress(nextDetail)
    onChange(formatAddress(baseAddress, nextDetail))
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
          onClick={() => {
            setManualMode(false)
            setSearchOpen(prev => !prev)
            setError('')
          }}
          className="flex-1 text-white font-black py-3 rounded-xl text-sm active:scale-95 transition-all"
          style={{ background: 'linear-gradient(135deg,#ff6a00,#e53935)' }}
        >
          네이버 주소검색
        </button>
        <button
          type="button"
          onClick={() => {
            setSearchOpen(false)
            setManualMode(true)
            setManualAddress(value)
          }}
          className="px-4 py-3 rounded-xl text-sm font-bold border border-gray-200 text-gray-500 active:scale-95 transition-all"
        >
          직접 입력
        </button>
      </div>

      {searchOpen && (
        <div className="rounded-xl border border-orange-200 bg-orange-50/40 p-3 space-y-2">
          <form onSubmit={searchAddress} className="flex gap-2">
            <input
              ref={searchInputRef}
              type="search"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="도로명, 건물명, 지번을 입력하세요"
              className="min-w-0 flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white"
            />
            <button
              type="submit"
              disabled={searching}
              className="px-4 py-2.5 rounded-xl text-sm font-black text-white disabled:opacity-50 active:scale-95 transition-all"
              style={{ background: 'linear-gradient(135deg,#ff6a00,#e53935)' }}
            >
              {searching ? '검색중' : '검색'}
            </button>
          </form>

          {error && <p className={`${smallTextClass} text-red-500`}>{error}</p>}

          {hasSearched && !error && searchResults.length === 0 && (
            <p className={`${smallTextClass} text-gray-500`}>검색 결과가 없습니다. 도로명이나 건물명을 조금 더 자세히 입력해 주세요.</p>
          )}

          {searchResults.length > 0 && (
            <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
              {searchResults.map((result, idx) => (
                <button
                  key={`${result.displayAddress}-${idx}`}
                  type="button"
                  onClick={() => selectAddress(result)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-left active:scale-[0.99] transition-all"
                >
                  <p className="text-sm font-bold text-gray-900 leading-snug">{result.displayAddress}</p>
                  {result.jibunAddress && result.jibunAddress !== result.displayAddress && (
                    <p className="text-[11px] text-gray-400 leading-snug mt-1">지번 {result.jibunAddress}</p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

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
            value={baseAddress}
            readOnly
            placeholder="주소 검색으로 배송지를 선택해 주세요"
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
        네이버 주소검색에서 기본주소를 선택한 뒤, 동·호수 같은 상세주소만 직접 입력해 주세요.
      </p>
    </div>
  )
}
