'use client'

import { createContext, useContext, useState, type ReactNode, useEffect } from 'react'

// Define available languages
export type Language = 'en' | 'es'

// Define translations
export const translations = {
  en: {
    // General
    appName: 'Saldo Cero',
    darkMode: 'Dark Mode',
    lightMode: 'Light Mode',
    youSure: 'Are you sure?',
    undoable: 'This action can’t be undone.',
    confirm: 'Yes, continue',

    // Setup
    setupTitle: 'Set Up Your Budget',
    setupDescription: 'Enter your starting amount and end date to calculate your daily budget.',
    startingAmount: 'Starting Amount',
    endDate: 'End Date',
    startTracking: 'Start Now',

    // Dashboard
    dailyBudget: 'Daily Budget',
    budgetForToday: 'Today’s available budget',
    dailyAllowance: 'Daily Allowance',
    remainingToday: 'Remaining Today',
    progress: 'Progress',
    totalBudget: 'Total Budget',
    totalAllAccounts: 'All accounts',
    selectBalanceAccount: 'Show balance for',
    trackModeDescription: 'Track your spending',

    remainingDays: 'Days Remaining',
    days: 'days',

    // Config
    budgetConfiguration: 'Budget Settings',
    updateBudgetSettings: 'Update Budget',
    modifyBudgetConfig: 'Adjust your budget details',
    updateSettings: 'Save Changes',
    clearData: 'Clear All Data',
    exportData: 'Export Data',
    cancel: 'Cancel',

    // Tabs
    expenses: 'Expenses',
    transfer: 'Transfer',
    accounts: 'Accounts',
    history: 'History',
    income: 'Income',

    // Transaction Form
    addIncome: 'Add Income',
    addIncomeDescription: 'Record a new income',
    addExpense: 'Add Expense',
    addExpenseDescription: 'Record a new expense',
    editTransaction: 'Edit Transaction',
    editTransactionDescription: 'Modify transaction details',
    updateTransaction: 'Update Transaction',
    amount: 'Amount',
    description: 'Description',
    account: 'Account',
    selectAccount: 'Select an account',
    expenseExceedsWarning: 'This expense exceeds today’s budget.',
    whatExpenseFor: 'What’s this expense for?',
    unnamedExpense: 'Unnamed Expense',
    recentExpenses: 'Recent Expenses',
    recentExpensesDescription: 'Your latest recorded expenses',
    noExpenses: 'No expenses yet',
    transactionType: 'Transaction Type',
    whatIncomeFor: 'What is this income for?',

    // Delete Transaction
    adjustmentDescription: 'Balance adjustment',
    deleteTransactionTitle: 'Delete transaction',
    deleteTransactionQuestion: 'What should happen to the balance?',
    deleteAndRefund: 'Delete and refund',
    deleteAndRefundDescription: 'Removes the transaction and returns the money to the account',
    deleteKeepBalance: 'Delete, keep balance',
    deleteKeepBalanceDescription: 'Removes the transaction without changing the balance',

    // Transfer Form
    transferFunds: 'Transfer Funds',
    transferDescription: 'Move money between your accounts',
    fromAccount: 'From',
    toAccount: 'To',
    selectSourceAccount: 'Choose source account',
    selectDestinationAccount: 'Choose destination account',
    whatTransferFor: 'Reason for transfer',

    // Accounts
    addNewAccount: 'Add New Account',
    createNewAccount: 'Create an account to organize your money',
    accountName: 'Account Name',
    accountType: 'Account Type',
    selectAccountType: 'Select type',
    createAccount: 'Create Account',
    editAccount: 'Edit Account',
    editAccountDescription: 'Change the name and icon of your account',
    accountIcon: 'Account Icon',
    accountNamePlaceholder: 'Enter a name',
    saveChanges: 'Save Changes',
    accountUpdated: 'Account Updated',
    accountUpdatedDescription: '{name} was updated successfully.',
    deleteAccount: 'Delete Account',
    deleteAccountConfirmation: "Delete '{name}'? This can’t be undone.",
    deleteAccountBalance: '{balance} will be moved to your {savings} account.',
    delete: 'Delete',
    accountDeleted: 'Account Deleted',
    accountDeletedDescription: '{name} has been deleted.',
    hideAccount: 'Hide from totals',
    showAccount: 'Show in totals',

    // Account Types
    daily: 'Daily Budget',
    savings: 'Savings',
    investment: 'Investment',
    expense: 'Expense',

    // Transaction History
    transactionHistory: 'Transaction History',
    transactionDescription: 'All your recent activity',
    date: 'Date',
    noTransactions: 'No transactions yet',

    // Toasts
    expenseAdded: 'Expense Added',
    expenseAddedDescription: '{amount} was added.',
    incomeAdded: 'Income Added',
    incomeAddedDescription: '{amount} was added.',
    transactionUpdated: 'Transaction Updated',
    transactionUpdatedDescription: '{amount} was updated.',
    invalidAmount: 'Invalid Amount',
    invalidAmountDescription: 'Please enter a valid number',
    accountAdded: 'Account Created',
    accountAddedDescription: 'The {name} account is now active.',
    invalidAccountName: 'Invalid Name',
    invalidAccountNameDescription: 'Please enter a valid name',
    missingAccounts: 'Accounts Missing',
    missingAccountsDescription: 'Please select both source and destination accounts',
    invalidTransfer: 'Invalid Transfer',
    invalidTransferDescription: 'Can’t transfer to the same account',
    insufficientFunds: 'Not Enough Funds',
    insufficientFundsDescription: 'Balance too low in {account}',
    transferComplete: 'Transfer Complete',
    transferCompleteDescription: '{amount} moved successfully.',
    missingInformation: 'Missing Information',
    missingInformationDescription: 'Please complete all fields',
    configUpdated: 'Budget Updated',
    configUpdatedDescription: 'Your settings were saved.',
    noAccounts: 'No accounts available',
    noAccountsDescription: 'Please add accounts before making transfers.',
    insufficientAccounts: 'Need more accounts',
    insufficientAccountsDescription: 'You need at least 2 accounts to make transfers.',
    transferSuccess: 'Transfer Complete',
    transferSuccessDescription: '{amount} moved successfully.',

    // Date picker
    pickDate: 'Pick a date',

    // Auth
    authSignIn: 'Sign In',
    authSignUp: 'Create Account',
    authWelcomeBack: 'Welcome back',
    authWelcomeBackDescription: 'Sign in to your account to continue.',
    authCreateAccountTitle: 'Create your account',
    authCreateAccountDescription: 'Sign up to start tracking your budget.',
    authEmail: 'Email',
    authEmailPlaceholder: 'you@example.com',
    authPassword: 'Password',
    authConfirmPassword: 'Confirm Password',
    authInvalidEmail: 'Enter a valid email address.',
    authPasswordMin: 'Password must be at least 8 characters.',
    authPasswordRequired: 'Password is required.',
    authPasswordMismatch: 'Passwords do not match.',
    authSigningIn: 'Signing in...',
    authCreatingAccount: 'Creating account...',
    authInvalidCredentials: 'Invalid email or password.',
    authEmailInUse: 'An account with this email already exists.',
    authWeakPassword: 'Password is too weak.',
    authGenericError: 'Something went wrong. Please try again.',
    authRateLimit: 'Too many attempts. Please try again in a moment.',
    authCheckEmail: 'Check your email to confirm your account, then sign in.',
    authSignOut: 'Sign Out',
    authLoading: 'Loading...',

    // Sync
    syncSync: 'Sync',
    syncSyncing: 'Syncing…',
    syncSynced: 'Synced',
    syncLastSync: 'Last sync: {time}',
    syncError: 'Sync failed',
    syncErrorDescription: 'Check your connection and sync code, then try again.',
    syncConfigPending: 'Sync not configured',
    syncConfigPendingDescription: 'Add your sync code and token in Settings.',
    syncFirstPushPending: 'First sync pending',
    syncFirstPushPendingDescription: 'Push your data for the first time.',
    syncSettingsTitle: 'Sync settings',
    syncCodeLabel: 'Sync code',
    syncTokenLabel: 'Sync token',
    syncSave: 'Save',
    syncSaveDescription: 'Your sync code and token are stored only on this device.',
    syncConfigSaved: 'Config saved',
    syncFirstPushTitle: 'Push data for the first time?',
    syncFirstPushDescription: 'Your current data will be uploaded as the initial snapshot. You will not be able to push again until the relay is empty.',
    syncUploadFirst: 'Upload data for the first time',
    syncBackupsTitle: 'Local backups',
    syncRestore: 'Restore',
    syncRestored: 'Backup restored',
    syncNoBackups: 'No backups yet'
  }, es: {
    // General
    appName: 'Saldo Cero',
    darkMode: 'Modo Oscuro',
    lightMode: 'Modo Claro',
    youSure: '¿Estás seguro?',
    undoable: 'Esta acción no se puede deshacer.',
    confirm: 'Sí, continuar',

    // Setup
    setupTitle: 'Configura tu presupuesto',
    setupDescription: 'Ingresa tu monto inicial y fecha final para calcular tu presupuesto diario.',
    startingAmount: 'Monto inicial',
    endDate: 'Fecha final',
    startTracking: 'Comenzar ahora',

    // Dashboard
    dailyBudget: 'Presupuesto Diario',
    budgetForToday: 'Presupuesto disponible hoy',
    dailyAllowance: 'Asignación diaria',
    remainingToday: 'Disponible hoy',
    progress: 'Progreso',
    totalBudget: 'Presupuesto total',
    totalAllAccounts: 'Todas las cuentas',
    selectBalanceAccount: 'Mostrar balance de',
    trackModeDescription: 'Modo seguimiento',

    remainingDays: 'Días restantes',
    days: 'días',

    // Config
    budgetConfiguration: 'Configuración de presupuesto',
    updateBudgetSettings: 'Actualizar presupuesto',
    modifyBudgetConfig: 'Ajusta los detalles de tu presupuesto',
    updateSettings: 'Guardar cambios',
    clearData: 'Borrar todos los datos',
    exportData: 'Exportar datos',
    cancel: 'Cancelar',

    // Tabs
    expenses: 'Gastos',
    transfer: 'Transferencias',
    accounts: 'Cuentas',
    history: 'Historial',
    income: 'Ingresos',

    // Transaction Form
    addIncome: 'Agregar ingreso',
    addIncomeDescription: 'Registra un nuevo ingreso',
    addExpense: 'Agregar gasto',
    addExpenseDescription: 'Registra un nuevo gasto',
    editTransaction: 'Editar transacción',
    editTransactionDescription: 'Modificar detalles de la transacción',
    updateTransaction: 'Actualizar transacción',
    amount: 'Monto',
    description: 'Descripción',
    account: 'Cuenta',
    selectAccount: 'Selecciona una cuenta',
    expenseExceedsWarning: 'Este gasto excede tu presupuesto diario.',
    whatExpenseFor: '¿Para qué es este gasto?',
    whatIncomeFor: '¿Para qué es este ingreso?',
    unnamedExpense: 'Gasto sin nombre',
    recentExpenses: 'Gastos recientes',
    recentExpensesDescription: 'Tus gastos más recientes',
    noExpenses: 'Aún no hay gastos',
    transactionType: 'Tipo de transacción',

    // Delete Transaction
    adjustmentDescription: 'Ajuste de saldo',
    deleteTransactionTitle: 'Eliminar transacción',
    deleteTransactionQuestion: '¿Qué hacer con el saldo?',
    deleteAndRefund: 'Eliminar y devolver',
    deleteAndRefundDescription: 'Elimina la transacción y devuelve el dinero a la cuenta',
    deleteKeepBalance: 'Eliminar, mantener saldo',
    deleteKeepBalanceDescription: 'Elimina la transacción sin modificar el saldo',

    // Transfer Form
    transferFunds: 'Transferir fondos',
    transferDescription: 'Mueve dinero entre tus cuentas',
    fromAccount: 'Desde',
    toAccount: 'Hacia',
    selectSourceAccount: 'Elige cuenta de origen',
    selectDestinationAccount: 'Elige cuenta de destino',
    whatTransferFor: 'Motivo de la transferencia',

    // Accounts
    addNewAccount: 'Agregar nueva cuenta',
    createNewAccount: 'Crea una cuenta para organizar tu dinero',
    accountName: 'Nombre de cuenta',
    accountType: 'Tipo de cuenta',
    selectAccountType: 'Selecciona tipo',
    createAccount: 'Crear cuenta',
    editAccount: 'Editar cuenta',
    editAccountDescription: 'Modifica el nombre e ícono de la cuenta',
    accountIcon: 'Ícono de cuenta',
    accountNamePlaceholder: 'Escribe un nombre',
    saveChanges: 'Guardar cambios',
    accountUpdated: 'Cuenta actualizada',
    accountUpdatedDescription: 'La cuenta {name} fue actualizada con éxito.',
    deleteAccount: 'Eliminar cuenta',
    deleteAccountConfirmation: "¿Eliminar '{name}'? Esta acción no se puede deshacer.",
    deleteAccountBalance: '{balance} se transferirá a tu cuenta de {savings}.',
    delete: 'Eliminar',
    accountDeleted: 'Cuenta eliminada',
    accountDeletedDescription: 'La cuenta {name} ha sido eliminada.',
    hideAccount: 'Ocultar de los totales',
    showAccount: 'Mostrar en los totales',

    // Account Types
    daily: 'Presupuesto diario',
    savings: 'Ahorros',
    investment: 'Inversión',
    expense: 'Gasto',

    // Transaction History
    transactionHistory: 'Historial de transacciones',
    transactionDescription: 'Tu actividad financiera reciente',
    date: 'Fecha',
    noTransactions: 'Aún no hay transacciones',

    // Toasts
    expenseAdded: 'Gasto registrado',
    expenseAddedDescription: '{amount} fue agregado.',
    incomeAdded: 'Ingreso registrado',
    incomeAddedDescription: '{amount} fue registrado.',
    transactionUpdated: 'Transacción actualizada',
    transactionUpdatedDescription: '{amount} fue actualizado.',
    invalidAmount: 'Monto inválido',
    invalidAmountDescription: 'Por favor ingresa un número válido',
    accountAdded: 'Cuenta creada',
    accountAddedDescription: 'La cuenta {name} ya está activa.',
    invalidAccountName: 'Nombre inválido',
    invalidAccountNameDescription: 'Ingresa un nombre válido',
    missingAccounts: 'Faltan cuentas',
    missingAccountsDescription: 'Selecciona cuenta origen y destino',
    invalidTransfer: 'Transferencia inválida',
    invalidTransferDescription: 'No puedes transferir a la misma cuenta',
    insufficientFunds: 'Fondos insuficientes',
    insufficientFundsDescription: 'Saldo insuficiente en {account}',
    transferComplete: 'Transferencia completada',
    transferCompleteDescription: '{amount} se transfirió correctamente.',
    missingInformation: 'Falta información',
    missingInformationDescription: 'Completa todos los campos requeridos',
    configUpdated: 'Presupuesto actualizado',
    configUpdatedDescription: 'Los cambios se guardaron correctamente.',
    noAccounts: 'Sin cuentas disponibles',
    noAccountsDescription: 'Agrega cuentas antes de hacer transferencias.',
    insufficientAccounts: 'Se necesitan al menos 2 cuentas',
    insufficientAccountsDescription: 'Necesitas al menos 2 cuentas para transferir.',
    transferSuccess: 'Transferencia completada',
    transferSuccessDescription: '{amount} se transfirió correctamente.',

    // Date picker
    pickDate: 'Selecciona una fecha',

    // Auth
    authSignIn: 'Iniciar sesión',
    authSignUp: 'Crear cuenta',
    authWelcomeBack: 'Bienvenido de nuevo',
    authWelcomeBackDescription: 'Inicia sesión en tu cuenta para continuar.',
    authCreateAccountTitle: 'Crea tu cuenta',
    authCreateAccountDescription: 'Regístrate para comenzar a controlar tu presupuesto.',
    authEmail: 'Correo electrónico',
    authEmailPlaceholder: 'tu@ejemplo.com',
    authPassword: 'Contraseña',
    authConfirmPassword: 'Confirmar contraseña',
    authInvalidEmail: 'Ingresa un correo electrónico válido.',
    authPasswordMin: 'La contraseña debe tener al menos 8 caracteres.',
    authPasswordRequired: 'La contraseña es obligatoria.',
    authPasswordMismatch: 'Las contraseñas no coinciden.',
    authSigningIn: 'Iniciando sesión...',
    authCreatingAccount: 'Creando cuenta...',
    authInvalidCredentials: 'Correo o contraseña inválidos.',
    authEmailInUse: 'Ya existe una cuenta con este correo.',
    authWeakPassword: 'La contraseña es demasiado débil.',
    authGenericError: 'Algo salió mal. Inténtalo de nuevo.',
    authRateLimit: 'Demasiados intentos. Inténtalo de nuevo en un momento.',
    authCheckEmail: 'Revisa tu correo para confirmar tu cuenta y luego inicia sesión.',
    authSignOut: 'Cerrar sesión',
    authLoading: 'Cargando...',

    // Sync
    syncSync: 'Sincronizar',
    syncSyncing: 'Sincronizando…',
    syncSynced: 'Sincronizado',
    syncLastSync: 'Última sincronización: {time}',
    syncError: 'Error de sincronización',
    syncErrorDescription: 'Revisa tu conexión y tu sync code, luego intenta de nuevo.',
    syncConfigPending: 'Sincronización no configurada',
    syncConfigPendingDescription: 'Agrega tu sync code y token en Configuración.',
    syncFirstPushPending: 'Primera sincronización pendiente',
    syncFirstPushPendingDescription: 'Sube tus datos por primera vez.',
    syncSettingsTitle: 'Configuración de sincronización',
    syncCodeLabel: 'Código de sincronización',
    syncTokenLabel: 'Token de sincronización',
    syncSave: 'Guardar',
    syncSaveDescription: 'Tu sync code y token se guardan solo en este dispositivo.',
    syncConfigSaved: 'Configuración guardada',
    syncFirstPushTitle: '¿Subir datos por primera vez?',
    syncFirstPushDescription: 'Tus datos actuales se subirán como primer snapshot. No podrás volver a subir hasta que el relay esté vacío.',
    syncUploadFirst: 'Subir datos por primera vez',
    syncBackupsTitle: 'Copias de seguridad locales',
    syncRestore: 'Restaurar',
    syncRestored: 'Copia restaurada',
    syncNoBackups: 'No hay copias todavía'
  }
}

// Create the context
type LanguageContextType = {
  language: Language
  setLanguage: (lang: Language) => void
  t: (key: string, params?: Record<string, string | number>) => string
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined)

// Create the provider
export function LanguageProvider({ children }: { children: ReactNode }) {
  // SSR-safe: el primer render SIEMPRE es 'es' (server y client idénticos).
  // Leer localStorage/navigator aquí rompería la hidratación (server no tiene
  // acceso a ellos y renderizaría 'es' mientras el cliente elegiría 'en').
  const [language, setLanguage] = useState<Language>('es')

  // Detección post-mount: localStorage > navigator.language > 'es'.
  useEffect(() => {
    const stored = localStorage.getItem('language')
    if (stored === 'en' || stored === 'es') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR-safe hydration: detect browser prefs post-mount
      setLanguage(stored)
      return
    }
    const browserLang = navigator.language.split('-')[0].toLowerCase()
    if (browserLang === 'en' || browserLang === 'es') {
      setLanguage(browserLang as Language)
    }
  }, [])

  // Effect to save language changes to localStorage
  useEffect(() => {
    localStorage.setItem('language', language)
  }, [language])

  // Function to get translation
  const t = (key: string, params?: Record<string, string | number>) => {
    const translation = translations[language][key as keyof typeof translations[Language]] || key

    if (params) {
      return Object.entries(params).reduce((acc, [paramKey, paramValue]) => {
        return acc.replace(`{${paramKey}}`, String(paramValue))
      }, translation)
    }

    return translation
  }

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

// Custom hook to use the language context
export function useLanguage() {
  const context = useContext(LanguageContext)
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider')
  }
  return context
}
