'use client'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { installCustomerExitGuard, isCustomerRoute } from '@/lib/customer-navigation'

export default function CustomerExitGuard() {
  const pathname = usePathname()
  useEffect(() => {
    if (isCustomerRoute(pathname)) return installCustomerExitGuard(window, document)
  }, [pathname])
  return null
}
