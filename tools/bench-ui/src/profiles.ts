import type { Suite } from '../shared/types'

export const SUITE_INFO: Record<Suite, string> = {
  backend: 'An internal operation, including database access when needed',
  http: 'An authenticated API request, through receiving the response',
  browser: 'A page load or interaction, until its data and charts are ready',
  load: 'Work happening at the same time, including waiting in queues',
}

export const PROFILE_INFO: Record<string, string> = {
  smoke: 'Small setup check: 2 accounts, 4 holdings, 600 transactions',
  typical: '6 accounts, 13 holdings, 5,000 transactions, 1,300 days of history',
  'large-ledger': '100,000 transactions',
  'active-investor': 'Many securities and buy/sell lots',
  'long-history': '10 years of history, including missing prices',
  'multi-currency': 'EUR, USD and GBP holdings',
  'transfer-heavy': 'Many transfers between accounts',
  'shared-database': '100 users sharing the database',
  'large-portfolio': '40 accounts and 500 holdings',
}
