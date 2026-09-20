import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useHotkeys } from '@/hooks/use-hotkeys'

/**
 * Desktop shortcuts (issue #10, Phase C). These are the guards that keep the
 * shortcuts from hijacking typing or firing on mobile, so each one is asserted
 * explicitly: viewport, focus context, modifiers, key repeat and unmapped keys.
 */
function mockViewport({ desktop }: { desktop: boolean }): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: desktop,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  })) as unknown as typeof window.matchMedia
}

function Probe({ handlers }: { handlers: Record<string, () => void> }) {
  useHotkeys(handlers)
  return (
    <div>
      <input aria-label="campo" />
      <textarea aria-label="notas" />
      <div contentEditable aria-label="editor" role="textbox" />
    </div>
  )
}

describe('useHotkeys', () => {
  beforeEach(() => {
    window.localStorage.clear()
    mockViewport({ desktop: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fires the mapped handler on the desktop viewport', () => {
    const onNewTransaction = vi.fn()
    render(<Probe handlers={{ n: onNewTransaction }} />)

    fireEvent.keyDown(document.body, { key: 'n' })

    expect(onNewTransaction).toHaveBeenCalledTimes(1)
  })

  it('matches keys case-insensitively', () => {
    const onTransfer = vi.fn()
    render(<Probe handlers={{ t: onTransfer }} />)

    fireEvent.keyDown(document.body, { key: 'T' })

    expect(onTransfer).toHaveBeenCalledTimes(1)
  })

  it('ignores keys below the desktop breakpoint', () => {
    mockViewport({ desktop: false })
    const onNewTransaction = vi.fn()
    render(<Probe handlers={{ n: onNewTransaction }} />)

    fireEvent.keyDown(document.body, { key: 'n' })

    expect(onNewTransaction).not.toHaveBeenCalled()
  })

  it('never hijacks keys typed into inputs, textareas or editable content', () => {
    const onNewTransaction = vi.fn()
    render(<Probe handlers={{ n: onNewTransaction }} />)

    const editable = screen.getByLabelText('editor')
    // jsdom does not implement isContentEditable (reports undefined) while real
    // browsers report true for a contenteditable region and its descendants, so
    // mirror the browser value here before asserting the guard.
    Object.defineProperty(editable, 'isContentEditable', { value: true })

    fireEvent.keyDown(screen.getByLabelText('campo'), { key: 'n' })
    fireEvent.keyDown(screen.getByLabelText('notas'), { key: 'n' })
    fireEvent.keyDown(editable, { key: 'n' })

    expect(onNewTransaction).not.toHaveBeenCalled()
  })

  it('ignores keys held with a modifier', () => {
    const onNewTransaction = vi.fn()
    render(<Probe handlers={{ n: onNewTransaction }} />)

    fireEvent.keyDown(document.body, { key: 'n', metaKey: true })
    fireEvent.keyDown(document.body, { key: 'n', ctrlKey: true })
    fireEvent.keyDown(document.body, { key: 'n', altKey: true })

    expect(onNewTransaction).not.toHaveBeenCalled()
  })

  it('ignores repeated keydown events', () => {
    const onNewTransaction = vi.fn()
    render(<Probe handlers={{ n: onNewTransaction }} />)

    fireEvent.keyDown(document.body, { key: 'n', repeat: true })

    expect(onNewTransaction).not.toHaveBeenCalled()
  })

  it('ignores keys with no registered handler', () => {
    const onNewTransaction = vi.fn()
    render(<Probe handlers={{ n: onNewTransaction }} />)

    fireEvent.keyDown(document.body, { key: 'z' })

    expect(onNewTransaction).not.toHaveBeenCalled()
  })

  it('always dispatches to the latest handlers without re-subscribing', () => {
    const first = vi.fn()
    const second = vi.fn()
    const addSpy = vi.spyOn(window, 'addEventListener')

    const { rerender } = render(<Probe handlers={{ n: first }} />)
    const subscriptions = addSpy.mock.calls.filter(([type]) => type === 'keydown').length

    rerender(<Probe handlers={{ n: second }} />)
    fireEvent.keyDown(document.body, { key: 'n' })

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    expect(
      addSpy.mock.calls.filter(([type]) => type === 'keydown').length
    ).toBe(subscriptions)
  })

  it('stops listening once unmounted', () => {
    const onNewTransaction = vi.fn()
    const { unmount } = render(<Probe handlers={{ n: onNewTransaction }} />)

    unmount()
    fireEvent.keyDown(document.body, { key: 'n' })

    expect(onNewTransaction).not.toHaveBeenCalled()
  })
})
