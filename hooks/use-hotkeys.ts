'use client'

import { useEffect, useRef } from 'react'

/**
 * Desktop-only keyboard shortcuts (issue #10, Phase C).
 *
 * Keys are ignored below 1024px (`lg:`), while typing in inputs/contenteditable,
 * and when a modifier key is held. Discoverability is provided by
 * `aria-keyshortcuts`/`title` on the sidebar actions.
 *
 * The callbacks object is kept in a ref so the effect subscribes exactly once and
 * always dispatches to the latest handlers without forcing re-subscriptions.
 */
export function useHotkeys(handlers: Record<string, () => void>) {
  const handlersRef = useRef(handlers)

  // Keep the latest handlers without re-subscribing the keydown listener.
  useEffect(() => {
    handlersRef.current = handlers
  })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.repeat) return

      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return
      }

      // Desktop shell only; never hijack keys on small screens.
      if (!window.matchMedia('(min-width: 1024px)').matches) return

      const handler = handlersRef.current[event.key.toLowerCase()]
      if (!handler) return

      event.preventDefault()
      handler()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}