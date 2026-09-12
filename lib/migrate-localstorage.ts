import { v5 as uuidv5 } from 'uuid'
import { getDb } from '@/lib/db/client'
import { saveToIndexedDB } from '@/lib/db/persistence'

// Namespace fijo para UUIDs deterministas en la migración
const MIGRATION_NAMESPACE = '3f8e4a12-7b6c-4d9e-8f0a-1b2c3d4e5f6a' as const

const STORAGE_KEY = 'daily-budget-data'
const MIGRATED_FLAG_KEY = 'daily-budget-data-migrated'

function stableUuid(type: string): string {
  return uuidv5(`daily-budget-account-${type}`, MIGRATION_NAMESPACE)
}

// Tipos esperados en localStorage (formato anterior)
type LocalStorageAccount = {
  id: string // slug como 'daily', 'savings', 'investment' o custom
  name: string
  type: string
  icon: string
  hidden: boolean
  balance: number
}

type LocalStorageBudget = {
  startAmount: number
  endDate: string | null
  startDate: string | null
  mode: 'daily' | 'track'
  autoSave: boolean
  isSetup: boolean
}

type LocalStorageTransaction = {
  id?: string
  type: string
  amount: number
  description?: string
  account: string
  date?: string
}

type LocalStorageData = {
  budget: LocalStorageBudget
  accounts: LocalStorageAccount[]
  transactions: LocalStorageTransaction[]
  dailyAllowance: number
  remainingToday: number
  progress: number
  lastCheckedDay: string | null
  isSetup: boolean
}

/**
 * migrateFromLocalStorage - Migra datos de localStorage al sql.js del cliente
 * (lib/db/client) y persiste el snapshot resultante a IndexedDB, de forma
 * idempotente.
 *
 * Guardas:
 * 1. Si no existe localStorage['daily-budget-data'] → return (nada que migrar)
 * 2. Si la tabla accounts ya tiene filas → return (ya migrado)
 * 3. Si ya fue marcado migrated → return
 *
 * Después de migrar exitosamente: persiste la DB a IndexedDB y marca
 * localStorage['daily-budget-data-migrated'] = 'true'.
 * No elimina localStorage['daily-budget-data'] (backup histórico).
 *
 * Returns true if migration was performed (or already migrated), false if skipped.
 */
export async function migrateFromLocalStorage(
  storedData?: string | null,
  alreadyMigrated?: string | null
): Promise<boolean> {
  const data = storedData ?? window.localStorage.getItem(STORAGE_KEY)
  const migratedFlag = alreadyMigrated ?? window.localStorage.getItem(MIGRATED_FLAG_KEY)

  // Guard 1: Verificar si existe datos en localStorage
  if (!data) {
    // No hay datos en localStorage, nada que migrar
    return false
  }

  let parsedData: LocalStorageData
  try {
    parsedData = JSON.parse(data)
  } catch {
    // Datos corruptos, no migrar
    return false
  }

  const db = await getDb()

  // Guard 2: Verificar si la tabla accounts ya tiene filas (ya migrado)
  const countStmt = db.prepare('SELECT COUNT(*) AS count FROM accounts')
  countStmt.step()
  const existingAccounts = countStmt.getAsObject() as { count: number }
  countStmt.free()

  if (existingAccounts.count > 0) {
    // Ya hay datos en SQLite, presumably migrado previamente
    return true
  }

  // Guard 3: Verificar si ya fue marcado como migrado
  if (migratedFlag === 'true') {
    // Ya migrado, no hacer nada
    return true
  }

  // Iniciar transacción SQLite para migrar todos los datos (sql.js no expone
  // db.transaction(fn): manejamos BEGIN/COMMIT/ROLLBACK manualmente).
  db.exec('BEGIN')
  try {
    // --- Paso A: Crear accounts con UUIDs estables ---
    const idMap: Record<string, string> = {
      // Cuentas default mapeadas por type a UUIDs fijos
      daily: stableUuid('daily'),
      savings: stableUuid('savings'),
      investment: stableUuid('investment')
    }

    // Procesar accounts custom y asegurar UUIDs estables
    const processedAccounts: {
      oldId: string
      newId: string
      account: LocalStorageAccount
    }[] = []

    // First, handle default accounts
    for (const [type] of Object.entries(idMap) as [string, string][]) {
      const existing = parsedData.accounts.find(
        (a: LocalStorageAccount) => a.type === type
      )
      if (existing) {
        idMap[type] = existing.id // Usar el ID existente si ya viene definido
      }
    }

    // Process all accounts including custom ones
    for (const acc of parsedData.accounts) {
      if (!idMap[acc.id]) {
        // Generar UUID estable para cualquier cuenta sin mapeo previo
        // (default no presentes en el idMap inicial o custom). El id original
        // de localStorage no se reutiliza como PK: SQLite lo normaliza a UUID.
        idMap[acc.id] = uuidv5(
          `daily-budget-account-${acc.type}-${acc.name}`,
          MIGRATION_NAMESPACE
        )
      }
      processedAccounts.push({
        oldId: acc.id,
        newId: idMap[acc.id],
        account: acc
      })
    }

    // Insertar accounts en SQLite con UUIDs estable
    const today = new Date().toISOString().split('T')[0]
    for (const { newId, account } of processedAccounts) {
      const stmt = db.prepare(
        `
        INSERT INTO accounts (id, name, type, icon, hidden, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
      `
      )
      stmt.run([
        newId,
        account.name,
        account.type,
        account.icon ? account.icon : 'wallet',
        account.hidden ? 1 : 0,
        today,
        new Date().toISOString()
      ])
      stmt.free()
    }

    // --- Paso B: Re-mapear transactions (account → account_id) ---

    // Insertar transactions con account_id en lugar de account (slug)
    for (const tx of parsedData.transactions) {
      const accountIdMap = idMap[tx.account] // mapear el account slug a UUID
      if (!accountIdMap) {
        // Si no encontramos el mapeo, saltar esta transacción
        continue
      }

      const amountInt = Math.floor(tx.amount ?? 0)

      const stmt = db.prepare(
        `
        INSERT INTO transactions (id, type, amount, description, account_id, date, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
      `
      )
      stmt.run([
        tx.id || crypto.randomUUID(),
        tx.type,
        amountInt,
        tx.description || '',
        accountIdMap,
        tx.date || today,
        new Date().toISOString(),
        new Date().toISOString()
      ])
      stmt.free()
    }

    // --- Paso C: Insertar budget singleton ---

    const budget = parsedData.budget
    const budgetStartDate = budget.startDate
      ? new Date(budget.startDate).toISOString().split('T')[0]
      : null
    const budgetEndDate = budget.endDate
      ? new Date(budget.endDate).toISOString().split('T')[0]
      : null

    const budgetStmt = db.prepare(
      `
      INSERT INTO budgets (id, start_amount, start_date, end_date, auto_save, mode, is_setup, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `
    )
    budgetStmt.run([
      'default',
      budget.startAmount,
      budgetStartDate,
      budgetEndDate,
      budget.autoSave ? 1 : 0,
      budget.mode,
      budget.isSetup ? 1 : 0,
      new Date().toISOString()
    ])
    budgetStmt.free()

    // --- Paso D: Commitar la transacción ---
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  // Persistir el snapshot migrado a IndexedDB para que sobreviva a recargas.
  await saveToIndexedDB(db)
  // Marcar en localStorage como migrated (backup histórico preservado).
  window.localStorage.setItem(MIGRATED_FLAG_KEY, 'true')

  return true
}