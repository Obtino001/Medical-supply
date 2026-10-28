import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { addToWishlist, removeFromWishlist } from '../lib/actions'
import { useData } from '../lib/data'
import { IconStar } from './icons'
import { Button, cx, useConfirm, useToast } from './ui'

export function WishlistToggle({
  productId,
  small = true,
  compact = false,
}: {
  productId: string
  small?: boolean
  compact?: boolean
}) {
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
        const ok = await confirm({
          title: 'Remove from wishlist?',
          body: 'The product and its price history stay in the system. Only the wishlist entry is removed, for both partners.',
          confirmLabel: 'Remove',
          danger: true,
        })
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

  if (compact) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={run}
        aria-pressed={!!item}
        aria-label={item ? 'Remove from shared wishlist' : 'Add to shared wishlist'}
        title={item ? 'On the shared wishlist (click to remove)' : 'Add to shared wishlist'}
        className={cx(
          'inline-flex h-8 w-8 sm:h-7.5 sm:w-auto sm:px-2 items-center justify-center gap-1 rounded-md border text-xs font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-[var(--color-primary)] disabled:opacity-50',
          item
            ? 'border-[var(--color-primary-border)] bg-[var(--color-primary-light)] text-[var(--color-primary)]'
            : 'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
        )}
      >
        <IconStar size={13} filled={!!item} className={item ? 'text-[#F9AB00]' : 'text-[var(--text-secondary)]'} />
        <span className="hidden lg:inline">{item ? 'Saved' : 'Wishlist'}</span>
      </button>
    )
  }

  return (
    <Button
      variant={item ? 'primary' : 'secondary'}
      small={small}
      disabled={busy}
      onClick={run}
      aria-pressed={!!item}
      title={item ? 'On the shared wishlist' : 'Add to shared wishlist'}
    >
      <IconStar size={14} filled={!!item} className={item ? 'text-[#FDD663]' : 'text-[var(--text-secondary)]'} />
      <span>{item ? 'Wishlisted' : 'Wishlist'}</span>
    </Button>
  )
}
