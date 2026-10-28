import { ProductBrowser } from '../components/ProductBrowser'
import { PageHeader } from '../components/ui'

export default function Compare() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Compare prices"
        subtitle="Find the best supplier price for each medicine."
      />
      <ProductBrowser mode="compare" />
    </div>
  )
}
