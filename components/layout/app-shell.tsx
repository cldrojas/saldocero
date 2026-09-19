'use client'

import type { ReactNode } from 'react'
import { SidebarNav, type SidebarNavProps } from './sidebar-nav'

interface AppShellProps {
  nav: SidebarNavProps
  children: ReactNode
}

/**
 * Desktop layout shell (issue #10, Phase A).
 * At lg+ renders a fixed sidebar column + content area. Below lg the shell is
 * inert: the mobile chrome (tab bar + FAB, hidden at lg via the same surface
 * state) keeps rendering exactly as before.
 */
export function AppShell({ nav, children }: AppShellProps) {
  return (
    <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="hidden lg:block">
        <div className="sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto border-r px-3 py-6">
          <SidebarNav {...nav} />
        </div>
      </aside>
      <div className="min-w-0 px-4 py-6 md:px-8">{children}</div>
    </div>
  )
}