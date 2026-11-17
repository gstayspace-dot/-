import { readProductMetaRegistry } from './supabaseClient'
import { hasPurchaseChoices } from './purchase-config'
export async function purchaseGroups() {
  const registry = await readProductMetaRegistry()
  const groups = Object.entries(registry).filter(([,value]) => hasPurchaseChoices(value.purchaseConfig)).map(([id,value]) => ({ id, ...value.purchaseConfig! }))
  const members = new Set(groups.flatMap(group => [...group.variants, ...group.addons].filter(c => c.productId !== group.id).map(c => c.productId)))
  return { groups, members }
}
