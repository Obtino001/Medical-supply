import { ProductBrowser } from '../components/ProductBrowser'
import { PageHeader } from '../components/ui'

export default function Compare() {
  return (
    <div>
      <PageHeader title="Compare prices" />
      <p className="mb-3 text-sm text-slate-600">Offers are compared only between the same variant (same grams, strength and pack size). Different variants are separate products and are never ranked against each other.</p>
      <ProductBrowser mode="compare" />
    </div>
  )
}
