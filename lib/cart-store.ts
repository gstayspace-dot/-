export type CartItem = {
  productId: string
  productName: string
  price: number
  quantity: number
  imageUrl: string
}

const CART_KEY = 'tlc_cart_v1'

function load(): CartItem[] {
  if (typeof window === 'undefined') return []
  try { return JSON.parse(localStorage.getItem(CART_KEY) ?? '[]') as CartItem[] }
  catch { return [] }
}

function save(cart: CartItem[]): void {
  localStorage.setItem(CART_KEY, JSON.stringify(cart))
}

export function getCart(): CartItem[] { return load() }

export function addToCart(item: Omit<CartItem, 'quantity'>): void {
  const cart = load()
  const idx = cart.findIndex(c => c.productId === item.productId)
  if (idx >= 0) { cart[idx].quantity++ } else { cart.push({ ...item, quantity: 1 }) }
  save(cart)
}

export function setItemQuantity(productId: string, qty: number): void {
  const cart = load()
  if (qty <= 0) { save(cart.filter(c => c.productId !== productId)); return }
  const idx = cart.findIndex(c => c.productId === productId)
  if (idx >= 0) { cart[idx].quantity = qty; save(cart) }
}

export function removeFromCart(productId: string): void {
  save(load().filter(c => c.productId !== productId))
}

export function clearCart(): void { save([]) }

export function getCartTotal(cart: CartItem[]): number {
  return cart.reduce((s, i) => s + i.price * i.quantity, 0)
}

export function getCartCount(cart: CartItem[]): number {
  return cart.reduce((s, i) => s + i.quantity, 0)
}
