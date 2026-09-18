import { addDays, subDays } from 'date-fns'
import { toInt } from '@/types'
import type { TestAppState, TestAccountConfig } from './test-utils'

/**
 * Pre-configured test scenarios for different testing needs
 */

// Basic setup with minimal accounts
export const BASIC_SETUP: TestAppState = {
  budget: {
    startAmount: 500,
    endDate: addDays(new Date(), 14),
    autoSave: false
  },
  accounts: [
    {
      id: 'daily',
      name: 'Daily Budget',
      type: 'daily',
      balance: 500,
      icon: 'wallet'
    },
    {
      id: 'savings',
      name: 'Savings',
      type: 'savings',
      balance: 0,
      icon: 'piggybank'
    }
  ],
  isSetup: true
}

// High balance scenario for testing large transfers
export const HIGH_BALANCE_SETUP: TestAppState = {
  budget: {
    startAmount: 10000,
    endDate: addDays(new Date(), 30),
    autoSave: true
  },
  accounts: [
    {
      id: 'daily',
      name: 'Daily Budget',
      type: 'daily',
      balance: 10000,
      icon: 'wallet'
    },
    {
      id: 'savings',
      name: 'Savings',
      type: 'savings',
      balance: 5000,
      icon: 'piggybank'
    },
    {
      id: 'investment',
      name: 'Investment',
      type: 'investment',
      balance: 15000,
      icon: 'trending-up'
    },
    {
      id: 'emergency',
      name: 'Emergency Fund',
      type: 'savings',
      balance: 3000,
      icon: 'shield'
    }
  ],
  isSetup: true
}

// Low balance scenario for testing insufficient funds
export const LOW_BALANCE_SETUP: TestAppState = {
  budget: {
    startAmount: 100,
    endDate: addDays(new Date(), 7),
    autoSave: false
  },
  accounts: [
    {
      id: 'daily',
      name: 'Daily Budget',
      type: 'daily',
      balance: 100,
      icon: 'wallet'
    },
    {
      id: 'savings',
      name: 'Savings',
      type: 'savings',
      balance: 50,
      icon: 'piggybank'
    }
  ],
  isSetup: true
}

// Multiple account types for comprehensive testing
export const MULTI_ACCOUNT_SETUP: TestAppState = {
  budget: {
    startAmount: 2000,
    endDate: addDays(new Date(), 21),
    autoSave: true
  },
  accounts: [
    {
      id: 'daily',
      name: 'Daily Budget',
      type: 'daily',
      balance: 2000,
      icon: 'wallet'
    },
    {
      id: 'savings',
      name: 'Savings',
      type: 'savings',
      balance: 1000,
      icon: 'piggybank'
    },
    {
      id: 'investment',
      name: 'Investment',
      type: 'investment',
      balance: 5000,
      icon: 'trending-up'
    },
    {
      id: 'checking',
      name: 'Checking',
      type: 'checking',
      balance: 1500,
      icon: 'credit-card'
    },
    {
      id: 'vacation',
      name: 'Vacation Fund',
      type: 'savings',
      balance: 800,
      icon: 'plane'
    }
  ],
  isSetup: true
}

// Edge case: Zero balance accounts
export const ZERO_BALANCE_SETUP: TestAppState = {
  budget: {
    startAmount: 0,
    endDate: addDays(new Date(), 1),
    autoSave: false
  },
  accounts: [
    {
      id: 'daily',
      name: 'Daily Budget',
      type: 'daily',
      balance: 0,
      icon: 'wallet'
    },
    {
      id: 'savings',
      name: 'Savings',
      type: 'savings',
      balance: 0,
      icon: 'piggybank'
    },
    {
      id: 'investment',
      name: 'Investment',
      type: 'investment',
      balance: 0,
      icon: 'trending-up'
    }
  ],
  isSetup: true
}

// Scenario with existing transactions for history testing
export const WITH_TRANSACTIONS_SETUP: TestAppState = {
  budget: {
    startAmount: 1500,
    endDate: addDays(new Date(), 30),
    autoSave: true
  },
  accounts: [
    {
      id: 'daily',
      name: 'Daily Budget',
      type: 'daily',
      balance: 1200,
      icon: 'wallet'
    },
    {
      id: 'savings',
      name: 'Savings',
      type: 'savings',
      balance: 800,
      icon: 'piggybank'
    },
    {
      id: 'investment',
      name: 'Investment',
      type: 'investment',
      balance: 2500,
      icon: 'trending-up'
    }
  ],
  transactions: [
    {
      id: 'test-tx-1',
      type: 'expense',
      amount: toInt(-50),
      description: 'Lunch',
      account: 'daily',
      date: subDays(new Date(), 2)
    },
    {
      id: 'test-tx-2',
      type: 'income',
      amount: toInt(200),
      description: 'Salary deposit',
      account: 'daily',
      date: subDays(new Date(), 5)
    },
    {
      id: 'test-tx-3',
      type: 'transfer',
      amount: toInt(100),
      description: 'Transfer to savings',
      account: 'savings',
      date: subDays(new Date(), 1)
    }
  ],
  isSetup: true
}

// Uninitialized state (for testing error handling)
export const UNINITIALIZED_SETUP: TestAppState = {
  budget: {
    startAmount: 0,
    endDate: new Date(),
    autoSave: false
  },
  accounts: [],
  isSetup: false
}

/**
 * Test data for specific UI component testing
 */

// Transfer form test data
export const TRANSFER_TEST_DATA = {
  validTransfer: {
    fromAccount: 'daily',
    toAccount: 'savings',
    amount: 100,
    description: 'Test transfer'
  },
  invalidTransfer: {
    fromAccount: 'daily',
    toAccount: 'daily', // Same account
    amount: 100,
    description: 'Invalid transfer'
  },
  insufficientFunds: {
    fromAccount: 'daily',
    toAccount: 'savings',
    amount: 99999, // More than balance
    description: 'Insufficient funds test'
  },
  zeroAmount: {
    fromAccount: 'daily',
    toAccount: 'savings',
    amount: 0,
    description: 'Zero amount test'
  },
  negativeAmount: {
    fromAccount: 'daily',
    toAccount: 'savings',
    amount: -50,
    description: 'Negative amount test'
  }
}

// Account creation test data
export const ACCOUNT_TEST_DATA = {
  newAccount: {
    name: 'Test Account',
    type: 'checking',
    balance: 500,
    icon: 'credit-card'
  },
  zeroBalanceAccount: {
    name: 'Empty Account',
    type: 'savings',
    balance: 0,
    icon: 'wallet'
  }
}

// Budget configuration test data
export const BUDGET_TEST_DATA = {
  smallBudget: {
    startAmount: 100,
    endDate: addDays(new Date(), 7)
  },
  largeBudget: {
    startAmount: 5000,
    endDate: addDays(new Date(), 90)
  },
  expiredBudget: {
    startAmount: 1000,
    endDate: subDays(new Date(), 1) // Yesterday
  }
}

/**
 * Helper function to get test data by scenario name
 */
export function getTestScenario(scenario: string): TestAppState {
  switch (scenario) {
    case 'basic':
      return BASIC_SETUP
    case 'high-balance':
      return HIGH_BALANCE_SETUP
    case 'low-balance':
      return LOW_BALANCE_SETUP
    case 'multi-account':
      return MULTI_ACCOUNT_SETUP
    case 'zero-balance':
      return ZERO_BALANCE_SETUP
    case 'with-transactions':
      return WITH_TRANSACTIONS_SETUP
    case 'uninitialized':
      return UNINITIALIZED_SETUP
    default:
      return BASIC_SETUP
  }
}

/**
 * Helper function to get transfer test data by type
 */
export function getTransferTestData(type: keyof typeof TRANSFER_TEST_DATA) {
  return TRANSFER_TEST_DATA[type]
}

/**
 * Helper function to get account test data by type
 */
export function getAccountTestData(type: keyof typeof ACCOUNT_TEST_DATA) {
  return ACCOUNT_TEST_DATA[type]
}

/**
 * Helper function to get budget test data by type
 */
export function getBudgetTestData(type: keyof typeof BUDGET_TEST_DATA) {
  return BUDGET_TEST_DATA[type]
}