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
import type { Budget, Int } from "@/types"

interface HeaderMenuProps {
  budget: Budget
  onUpdateConfig: (config: {
    startAmount?: Int
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
  const { theme, setTheme, resolvedTheme } = useTheme()
  const { t, language, setLanguage } = useLanguage()
  const { currency, setCurrency } = useCurrency()

  // Theme is unknown until mount: next-themes returns undefined on the server
  // but the stored theme on the client's first render, so reading it for the
  // icon/title diverges between SSR and hydration. Render the light state until
  // mounted, then reconcile.
  const [mounted, setMounted] = useState(false)

  /* eslint-disable react-hooks/set-state-in-effect -- mounted flag keeps the theme toggle SSR/client-consistent until next-themes resolves after mount */
  useEffect(() => {
    setMounted(true)
  }, [])
  /* eslint-enable react-hooks/set-state-in-effect */

  const isDarkMode = mounted && (theme || resolvedTheme) === "dark"

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
          onClick={() => setTheme(isDarkMode ? "light" : "dark")}
          title={isDarkMode ? t("lightMode") : t("darkMode")}
        >
          {isDarkMode ? (
            <Sun className="h-5 w-5" />
          ) : (
            <Moon className="h-5 w-5" />
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
                  <Separator />

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
