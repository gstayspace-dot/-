'use client'
import { usePathname } from 'next/navigation'
import CatalogDrawer from './CatalogDrawer'
import CustomerExitGuard from './CustomerExitGuard'
import OrderAlertGlobal from './OrderAlertGlobal'
import MarketingTracker from './MarketingTracker'
export default function AppServices() {
  const pathname = usePathname()
  if (pathname === '/live/overlay') return null
  return <><CatalogDrawer /><CustomerExitGuard /><OrderAlertGlobal /><MarketingTracker /></>
}
