import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
    <div>
      <PageHeader title="Product master">
        <Button onClick={() => setCreating(true)}>+ New product</Button>
      </PageHeader>
      <ProductBrowser mode="master" />
      {creating && (
        <ProductForm open onClose={() => setCreating(false)} onSaved={async (id) => { await reload(); toast('ok', 'Product created'); nav(`/products/${id}`) }} />
      )}
    </div>
  )
}
