import { ProductBrowser } from '../components/ProductBrowser'
import { PageHeader } from '../components/ui'

export default function Compare() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Compare prices"
        subtitle="Compare shop offer rates, discounts/schemes, and effective purchase prices across the shared workspace. The lowest valid effective price is highlighted in green."
      />
      <ProductBrowser mode="compare" />
    </div>
  )
}
