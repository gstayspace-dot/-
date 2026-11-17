export type PurchaseChoice = { productId: string; label: string }
export type PurchaseConfig = { title?: string; variantsTitle?: string; optionLabel?: string; variants: PurchaseChoice[]; addons: PurchaseChoice[] }

export function purchaseOptionLabel(config: PurchaseConfig): string {
  return config.optionLabel?.trim() || '색상'
}
export function purchaseSelectionTitle(config: PurchaseConfig): string {
  return config.variantsTitle?.trim() || `메인 상품 / ${purchaseOptionLabel(config)} 선택`
}
export function withPurchaseOptionLabel(config: PurchaseConfig, optionLabel: string): PurchaseConfig {
  const previousDefault = `메인 상품 / ${purchaseOptionLabel(config)} 선택`
  return { ...config, optionLabel,
    ...(!config.variantsTitle?.trim() || config.variantsTitle.trim() === previousDefault ? { variantsTitle: undefined } : {}),
  }
}

// A cleared editor may retain a title/version record, but it no longer owns products.
export function hasPurchaseChoices(config: PurchaseConfig | undefined): boolean {
  return Boolean(config && (config.variants.length || config.addons.length))
}
