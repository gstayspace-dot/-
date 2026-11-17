import type { Supplier, ProductOption, ProductAddon } from './commerce/types'
export type Product = {
  purchaseConfig?: import('./purchase-config').PurchaseConfig
  id: string
  name: string
  brand: string
  category: string
  isVisible: boolean
  imageUrl: string
  originalPrice: number
  livePrice: number
  quantity: number
  specs: string
  description: string
  createdAt: string
  isSoldOut?: boolean
  isBest?: boolean
  isLive?: boolean
  sortOrder?: number | null
  supplierId?: string | null
  supplier?: Supplier | null
  options?: ProductOption[]
  addons?: ProductAddon[]
  requiresOptions?: boolean
}
