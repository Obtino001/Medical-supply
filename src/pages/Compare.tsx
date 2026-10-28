import { ProductBrowser } from '../components/ProductBrowser'
import { PageHeader } from '../components/ui'

export default function Compare() {
  return (
    <div>
      <PageHeader title="Compare prices" />
      <p className="mb-3 text-sm text-slate-600">Compare shop offer rates, discounts/schemes, and effective purchase prices across the shared workspace. The lowest valid effective price is highlighted in green.</p>
      <ProductBrowser mode="compare" />
    </div>
  )
}
