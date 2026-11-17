import { readProductMetaRegistry } from './supabaseClient'
import { hasPurchaseChoices } from './purchase-config'
export async function purchaseGroups() {
  const registry = await readProductMetaRegistry()
  const groups = Object.entries(registry).filter(([,value]) => hasPurchaseChoices(value.purchaseConfig)).map(([id,value]) => ({ id, ...value.purchaseConfig! }))
  const representatives = new Set(groups.map(group => group.id))
  const members = new Set(groups.flatMap(group => [...group.variants, ...group.addons].filter(c => c.productId !== group.id && !representatives.has(c.productId)).map(c => c.productId)))
  return { groups, members }
}
