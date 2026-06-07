/**
 * In-memory mock store.
 *
 * To switch to Supabase, replace each function body with a Supabase client call.
 * The API routes and admin UI call only these functions, so the swap is isolated.
 *
 * globalThis is used to survive Next.js HMR module re-initialisation in dev.
 */

import type { Product } from './types'

// ── Seed data ────────────────────────────────────────────────────────────────

const SEED: Product[] = [
  {
    id: 'seed-1',
    name: '스테인리스 프리미엄 냄비 세트 5종',
    imageUrl: '',
    originalPrice: 89000,
    livePrice: 35600,
    quantity: 15,
    specs:
      '재질: 316L 스테인리스\n인덕션·가스·하이라이트 전기레인지 호환\n구성: 16 · 18 · 20 · 22 · 24cm 냄비 각 1개\n식기세척기 사용 가능 | 오븐 사용 불가',
    createdAt: new Date(Date.now() - 60_000).toISOString(),
  },
  {
    id: 'seed-2',
    name: '프리미엄 통주물 무쇠 프라이팬 28cm',
    imageUrl: '',
    originalPrice: 120000,
    livePrice: 54000,
    quantity: 8,
    specs:
      '재질: 무쇠(Cast Iron)\n사이즈: 직경 28cm · 높이 5cm\n인덕션·가스·캠핑 불꽃 모두 호환\n오깊은 시즈닝 처리로 즉시 사용 가능',
    createdAt: new Date(Date.now() - 30_000).toISOString(),
  },
]

// ── Types ─────────────────────────────────────────────────────────────────────

export type AdminAccount = {
  username: string
  password: string
  createdAt: string
}

// ── Persistent singleton (survives HMR) ──────────────────────────────────────

type Store = {
  products: Map<string, Product>
  activeProductIds: Set<string>
  adminAccounts: Map<string, AdminAccount>
}

declare global {
  // eslint-disable-next-line no-var
  var __mockStore: Store | undefined
}

function getStore(): Store {
  if (!global.__mockStore) {
    global.__mockStore = {
      products: new Map(SEED.map((p) => [p.id, p])),
      activeProductIds: new Set(['seed-1']),
      adminAccounts: new Map(),
    }
  }
  const s = global.__mockStore as Record<string, unknown>
  // Migrate old single-active schema
  if ('activeProductId' in s && !('activeProductIds' in s)) {
    const old = s.activeProductId as string | null
    ;(global.__mockStore as Store).activeProductIds = new Set(old ? [old] : [])
    delete s.activeProductId
  }
  // Ensure adminAccounts exists after HMR
  if (!global.__mockStore.adminAccounts) {
    global.__mockStore.adminAccounts = new Map()
  }
  return global.__mockStore
}

// ── Product API ───────────────────────────────────────────────────────────────

export function getProducts(): Product[] {
  return Array.from(getStore().products.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
}

export function addProduct(product: Product): void {
  getStore().products.set(product.id, product)
}

export function deleteProduct(id: string): boolean {
  return getStore().products.delete(id)
}

export function updateProduct(
  id: string,
  updates: Partial<Omit<Product, 'id' | 'createdAt'>>,
): Product | null {
  const store = getStore()
  const existing = store.products.get(id)
  if (!existing) return null
  const updated = { ...existing, ...updates }
  store.products.set(id, updated)
  return updated
}

// ── Live product API ──────────────────────────────────────────────────────────

export function getActiveProductIds(): string[] {
  return Array.from(getStore().activeProductIds)
}

export function addActiveProductId(id: string): boolean {
  getStore().activeProductIds.add(id)
  return true
}

export function removeActiveProductId(id: string): void {
  getStore().activeProductIds.delete(id)
}

export function clearActiveProductIds(): void {
  getStore().activeProductIds.clear()
}

export function getActiveProducts(): Product[] {
  const { products, activeProductIds } = getStore()
  return Array.from(activeProductIds)
    .map((id) => products.get(id))
    .filter(Boolean) as Product[]
}

export function getActiveProduct(): Product | null {
  return getActiveProducts()[0] ?? null
}

// ── Admin account API ─────────────────────────────────────────────────────────

export function getAdminAccounts(): AdminAccount[] {
  return Array.from(getStore().adminAccounts.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
}

export function findAdminAccount(username: string): AdminAccount | null {
  return getStore().adminAccounts.get(username) ?? null
}

export function addAdminAccount(account: AdminAccount): void {
  getStore().adminAccounts.set(account.username, account)
}

export function deleteAdminAccount(username: string): boolean {
  return getStore().adminAccounts.delete(username)
}
