export type PurchaseChoice = { productId: string; label: string }
export type PurchaseConfig = { title?: string; variantsTitle?: string; variants: PurchaseChoice[]; addons: PurchaseChoice[] }

// A cleared editor may retain a title/version record, but it no longer owns products.
export function hasPurchaseChoices(config: PurchaseConfig | undefined): boolean {
  return Boolean(config && (config.variants.length || config.addons.length))
}
