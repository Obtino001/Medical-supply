import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { addToWishlist, removeFromWishlist } from '../lib/actions'
import { useData } from '../lib/data'
import { IconStar } from './icons'
import { Button, useConfirm, useToast } from './ui'

export function WishlistToggle({ productId, small = true }: { productId: string; small?: boolean }) {
  const { wishlistMap, reload } = useData()
  const { userId } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const item = wishlistMap.get(productId)
  const run = async () => {
    setBusy(true)
    try {
      if (item) {
        const ok = await confirm({ title: 'Remove from wishlist?', body: 'The product and its price history stay in the system. Only the wishlist entry is removed, for both partners.', confirmLabel: 'Remove', danger: true })
        if (!ok) return
        await removeFromWishlist(item.id)
        toast('ok', 'Removed from wishlist')
      } else {
        await addToWishlist(productId)
        toast('ok', 'Added to shared wishlist')
      }
      await reload()
    } catch (e) {
      toast('err', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  void userId
  return (
    <Button
      variant={item ? 'primary' : 'secondary'}
      small={small}
      disabled={busy}
      onClick={run}
      aria-pressed={!!item}
      title={item ? 'On the shared wishlist' : 'Add to shared wishlist'}
    >
      <IconStar size={14} filled={!!item} className={item ? 'text-amber-300' : 'text-slate-400'} />
      <span>{item ? 'Wishlisted' : 'Wishlist'}</span>
    </Button>
  )
}
