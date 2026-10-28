import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconPlus } from '../components/icons'
import { ProductBrowser } from '../components/ProductBrowser'
import { ProductForm } from '../components/ProductForm'
import { Button, PageHeader, useToast } from '../components/ui'
import { useData } from '../lib/data'

export default function Products() {
  const [creating, setCreating] = useState(false)
  const { reload } = useData()
  const nav = useNavigate()
  const toast = useToast()
  return (
    <div className="space-y-3">
      <PageHeader
        title="Product master"
        subtitle="Normalized catalog of medical products, strengths, and supplier offers."
      >
        <Button small onClick={() => setCreating(true)}>
          <IconPlus size={15} />
          <span>New product</span>
        </Button>
      </PageHeader>
      <ProductBrowser mode="master" />
      {creating && (
        <ProductForm open onClose={() => setCreating(false)} onSaved={async (id) => { await reload(); toast('ok', 'Product created'); nav(`/products/${id}`) }} />
      )}
    </div>
  )
}
