type CustomerRouter = { back: () => void; push: (href: string) => void }
type BrowserNavigation = EventTarget & { canGoBack: boolean }
type NavigateDetails = Event & { destination?: { url: string }; downloadRequest?: string | null; signal?: AbortSignal }
export const CUSTOMER_EXIT_MESSAGE = '리빙라방 홈페이지를 나가시겠습니까?\n취소를 누르면 쇼핑을 계속할 수 있습니다.'
let allowedUntil = 0
let paymentRequests = 0

export function isCustomerRoute(path: string) {
  return !/^\/(admin|api|payment)(\/|$)/.test(path) && !/^\/live\/overlay(\/|$)/.test(path)
}
export function isOwnDestination(href: string, origin: string) {
  try { return new URL(href, origin).origin === origin } catch { return false }
}
function navigation(win: Window) { return (win as Window & { navigation?: BrowserNavigation }).navigation }
export function allowCustomerDeparture() { allowedUntil = Date.now() + 2000 }
function isAllowed() { return paymentRequests > 0 || Date.now() < allowedUntil }
/** An already-confirmed payment handoff must not receive an extra exit prompt. */
export async function withCustomerPayment<T>(action: () => Promise<T>): Promise<T> {
  paymentRequests++
  try { return await action() } finally { paymentRequests-- }
}
export function customerBack(router: CustomerRouter, fallback = '/') {
  if (window.history.length <= 1) { router.push(fallback); return }
  const nav = navigation(window)
  const ownPrevious = nav ? nav.canGoBack : Boolean(document.referrer && isOwnDestination(document.referrer, window.location.origin))
  if (ownPrevious) { if (!nav) allowCustomerDeparture(); router.back(); return }
  if (window.confirm(CUSTOMER_EXIT_MESSAGE)) { allowCustomerDeparture(); router.back() }
}

/** No synthetic history entries: cancelling an exit never traps browser Back. */
export function installCustomerExitGuard(win: Window, doc: Document) {
  let internalNavigation = false
  let resetTimer: ReturnType<typeof setTimeout> | undefined
  const reset = () => { internalNavigation = false; allowedUntil = 0 }
  const allowInternal = () => {
    internalNavigation = true
    clearTimeout(resetTimer)
    resetTimer = setTimeout(reset, 2000)
  }
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (internalNavigation || isAllowed()) return
    event.preventDefault()
    event.returnValue = ''
  }
  const navigate = (event: Event) => {
    const next = event as NavigateDetails
    const url = next.destination?.url ?? ''
    internalNavigation = isAllowed() || Boolean(next.downloadRequest) || Boolean(url && (isOwnDestination(url, win.location.origin) || /^(tel|mailto):/i.test(url)))
    allowedUntil = 0
    next.signal?.addEventListener('abort', reset, { once: true })
  }
  const click = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    const target = event.target as Element | null
    const link = typeof target?.closest === 'function' ? target.closest('a[href]') as HTMLAnchorElement | null : null
    if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return
    if (/^(tel|mailto):/i.test(link.href)) { allowInternal(); return }
    if (!/^https?:/i.test(link.href)) return
    if (isOwnDestination(link.href, win.location.origin)) { allowInternal(); return }
    if (!win.confirm(CUSTOMER_EXIT_MESSAGE)) { event.preventDefault(); event.stopPropagation(); return }
    allowCustomerDeparture()
  }
  const submit = (event: Event) => {
    const form = event.target as HTMLFormElement | null
    if (form?.action && isOwnDestination(form.action, win.location.origin)) allowInternal()
  }
  const nav = navigation(win)
  win.addEventListener('beforeunload', beforeUnload)
  win.addEventListener('pageshow', reset)
  win.addEventListener('popstate', reset)
  doc.addEventListener('click', click, true)
  doc.addEventListener('submit', submit, true)
  nav?.addEventListener('navigate', navigate)
  nav?.addEventListener('navigatesuccess', reset)
  nav?.addEventListener('navigateerror', reset)
  return () => {
    clearTimeout(resetTimer)
    win.removeEventListener('beforeunload', beforeUnload)
    win.removeEventListener('pageshow', reset)
    win.removeEventListener('popstate', reset)
    doc.removeEventListener('click', click, true)
    doc.removeEventListener('submit', submit, true)
    nav?.removeEventListener('navigate', navigate)
    nav?.removeEventListener('navigatesuccess', reset)
    nav?.removeEventListener('navigateerror', reset)
  }
}
