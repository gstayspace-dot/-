import type { Product } from './types'

export const fallbackProducts: Array<Product & { isLive: boolean }> = [
  {
    id: 'fallback-pot-set',
    name: '스테인리스 프리미엄 냄비 세트 5종',
    imageUrl: '',
    originalPrice: 89000,
    livePrice: 35600,
    quantity: 15,
    specs: '재질: 316L 스테인리스\n구성: 5종 세트\n인덕션, 가스레인지, 하이라이트 호환',
    description: '',
    createdAt: '2026-07-07T00:00:00.000Z',
    isLive: true,
    sortOrder: 0,
  },
  {
    id: 'fallback-pan-28',
    name: '프리미엄 무쇠 프라이팬 28cm',
    imageUrl: '',
    originalPrice: 120000,
    livePrice: 54000,
    quantity: 8,
    specs: '재질: 무쇠\n사이즈: 28cm\n라이브 방송 한정 특가',
    description: '',
    createdAt: '2026-07-07T00:01:00.000Z',
    isLive: false,
    sortOrder: 1,
  },
]
