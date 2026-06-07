export type Product = {
  id: string
  name: string
  imageUrl: string
  originalPrice: number
  livePrice: number
  quantity: number
  specs: string
  createdAt: string
  isLive?: boolean
}
