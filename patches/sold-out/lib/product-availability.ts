export function productIsSoldOut(product: { quantity: number; isSoldOut?: boolean } | undefined): boolean {
  return !product || product.isSoldOut === true || product.quantity <= 0
}
