import { catalogViewUrl, DEFAULT_CATALOG_VIEW } from './catalog-navigation'

export type DrawerProduct = { id: string; name: string; livePrice: number }
export type DrawerMetadata = { brands: string[]; categories: string[]; categoryCounts: Record<string, number> }
export function drawerHref(kind: 'brand' | 'category' | 'search', value: string) {
  const text = value.trim()
  return catalogViewUrl({ ...DEFAULT_CATALOG_VIEW, ...(kind === 'brand' ? { tab: 'brand' as const, brand: text } : kind === 'category' ? { category: text } : { query: text }) })
}
export function drawerLabelMatches(label: string, query: string) {
  const clean = (value: string) => value.normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase('ko')
  return clean(label).includes(clean(query))
}
export function drawerCatalog(data: { brands?: unknown; categories?: unknown; categoryCounts?: unknown; products?: unknown; total?: unknown }) {
  const labels = (value: unknown) => Array.isArray(value) ? Array.from(new Set(value.filter((label): label is string => typeof label === 'string' && !!label.trim()))) : []
  const counts = data.categoryCounts && typeof data.categoryCounts === 'object' ? data.categoryCounts as Record<string, unknown> : {}
  const categoryCounts: Record<string, number> = {}
  for (const [key, value] of Object.entries(counts)) if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) categoryCounts[key] = value
  const products: DrawerProduct[] = []
  if (Array.isArray(data.products)) for (const value of data.products) {
    if (value && typeof value === 'object' && typeof value.id === 'string' && typeof value.name === 'string' && typeof value.livePrice === 'number' && Number.isFinite(value.livePrice)) products.push({ id: value.id, name: value.name, livePrice: value.livePrice })
  }
  return { metadata: { brands: labels(data.brands), categories: labels(data.categories), categoryCounts }, products: products.slice(0, 6), total: typeof data.total === 'number' && Number.isSafeInteger(data.total) && data.total >= 0 ? data.total : products.length }
}
