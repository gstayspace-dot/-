export type PurchaseCartItem = { productId: string; quantity: number }

/** Add is cumulative. Review keeps at least the selected quantity already in cart. */
export function purchaseCartItems(existing: readonly PurchaseCartItem[], selected: readonly PurchaseCartItem[], reviewCart: boolean): PurchaseCartItem[] {
  function quantities(items: readonly PurchaseCartItem[]) {
    const result = new Map<string, number>()
    for (const item of items) {
      if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 999) throw new Error('상품 수량은 1~999개로 입력해주세요.')
      const quantity = (result.get(item.productId) ?? 0) + item.quantity
      if (quantity > 999) throw new Error('상품별 최대 수량은 999개입니다.')
      result.set(item.productId, quantity)
    }
    return result
  }
  const cart = quantities(existing), selection = quantities(selected)
  for (const [productId, quantity] of Array.from(selection.entries())) {
    const previous = cart.get(productId) ?? 0
    const next = reviewCart ? Math.max(previous, quantity) : previous + quantity
    if (next > 999) throw new Error('상품별 최대 수량은 999개입니다.')
    cart.set(productId, next)
  }
  return Array.from(cart, ([productId, quantity]) => ({ productId, quantity }))
}
