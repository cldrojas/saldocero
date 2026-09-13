"use client"

import { useEffect, useState } from "react"
import { Menu, Sun, Moon, Globe, CreditCard, Settings, ArrowLeft } from "lucide-react"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { useLanguage, type Language, translations } from "@/contexts/language-context"
import { useCurrency, type Currency, currencies } from "@/contexts/currency-context"
import { LanguageCurrencySelector } from "@/components/language-currency-selector"
import { ConfigForm } from "@/components/config-form"
import type { Budget } from "@/types"

interface HeaderMenuProps {
  budget: Budget
  onUpdateConfig: (config: {
    startAmount?: number
    endDate?: Date | undefined
    mode?: "daily" | "track"
    autoSave?: boolean
  }) => void
  onClearData: () => void
}

type SheetView = "menu" | "settings"

export function HeaderMenu({ budget, onUpdateConfig, onClearData }: HeaderMenuProps) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<SheetView>("menu")
  const [mounted, setMounted] = useState(false)
  const { theme, setTheme, resolvedTheme } = useTheme()
  const { t, language, setLanguage } = useLanguage()
  const { currency, setCurrency } = useCurrency()

  // SSR-safe: next-themes no resuelve el tema real (system) hasta el cliente.
  // Renderizar el botón con el theme del server causaría hydration mismatch.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- Hydration guard: must defer to client
  useEffect(() => setMounted(true), [])

  const isDarkMode = (theme || resolvedTheme) === "dark"

  const handleOpenSettings = () => setView("settings")
  const handleBackToMenu = () => setView("menu")

  // Reset view when sheet closes
  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) setView("menu")
  }

  return (
    <>
      {/* Desktop: inline icons */}
      <div className="hidden sm:flex items-center space-x-2">
        <LanguageCurrencySelector />
        <Button
          variant="ghost"
          size="icon"
          data-testid="theme-toggle"
          onClick={() => setTheme(isDarkMode ? "light" : "dark")}
          title={mounted ? (isDarkMode ? t("lightMode") : t("darkMode")) : undefined}
          aria-label={mounted ? (isDarkMode ? t("lightMode") : t("darkMode")) : undefined}
        >
          {mounted ? (
            isDarkMode ? (
              <Sun className="h-5 w-5" />
            ) : (
              <Moon className="h-5 w-5" />
            )
          ) : (
            <Sun className="h-5 w-5" />
          )}
        </Button>
      </div>

      {/* Mobile: hamburger + sheet */}
      <div className="sm:hidden">
        <Sheet open={open} onOpenChange={handleOpenChange}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-72 p-0">
            {view === "menu" ? (
              <>
                <SheetHeader className="p-6 pb-4">
                  <SheetTitle>{t("appName")}</SheetTitle>
                </SheetHeader>

                <nav className="flex flex-col px-6 pb-6" aria-label="Menu options">
                  {/* Language */}
                  <div className="py-3">
                    <div className="flex items-center gap-3 mb-2">
                      <Globe className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{t("language") || "Language"}</span>
                    </div>
                    <div className="flex gap-2 pl-7">
                      {(Object.keys(translations) as Language[]).map((lang) => (
                        <Button
                          key={lang}
                          variant={language === lang ? "default" : "outline"}
                          size="sm"
                          className="h-8"
                          onClick={() => setLanguage(lang)}
                        >
                          {lang === "en" ? "English" : "Español"}
                        </Button>
                      ))}
                    </div>
                  </div>

                  {/* Currency */}
                  <div className="py-3">
                    <div className="flex items-center gap-3 mb-2">
                      <CreditCard className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{t("currency") || "Currency"}</span>
                    </div>
                    <div className="flex flex-wrap gap-2 pl-7">
                      {(Object.keys(currencies) as Currency[]).map((curr) => (
                        <Button
                          key={curr}
                          variant={currency === curr ? "default" : "outline"}
                          size="sm"
                          className="h-8"
                          onClick={() => setCurrency(curr)}
                        >
                          {curr}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <Separator />

                  {/* Theme toggle */}
                  <button
                    className="flex items-center gap-3 py-3 w-full text-left hover:bg-muted/50 rounded-md px-1 -ml-1 transition-colors"
                    onClick={() => setTheme(isDarkMode ? "light" : "dark")}
                  >
                    {isDarkMode ? (
                      <Sun className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Moon className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="text-sm font-medium">
                      {isDarkMode ? t("lightMode") : t("darkMode")}
                    </span>
                  </button>

                  <Separator />

                  {/* Budget settings */}
                  <button
                    className="flex items-center gap-3 py-3 w-full text-left hover:bg-muted/50 rounded-md px-1 -ml-1 transition-colors"
                    onClick={handleOpenSettings}
                  >
                    <Settings className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{t("budgetConfiguration")}</span>
                  </button>
                </nav>
              </>
            ) : (
              /* Settings sub-view */
              <>
                <SheetHeader className="p-6 pb-4">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 -ml-2"
                      onClick={handleBackToMenu}
                      aria-label="Back to menu"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <SheetTitle>{t("budgetConfiguration")}</SheetTitle>
                  </div>
                </SheetHeader>
                <div className="px-6 pb-6 overflow-y-auto max-h-[calc(100vh-120px)]">
                  <ConfigForm
                    budget={budget}
                    onUpdateConfig={onUpdateConfig}
                    onClearData={onClearData}
                  />
                </div>
              </>
            )}
          </SheetContent>
        </Sheet>
      </div>
    </>
  )
}
