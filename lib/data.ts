import type { Transaction, Subscription } from "./types";

export const MOCK_TRANSACTIONS: Transaction[] = [
  { id: "1", merchant: "Netflix", amount: 15.99, date: "2025-01-28", category: "Entertainment", rawDescription: "NETFLIX.COM 15.99" },
  { id: "2", merchant: "Starbucks", amount: 5.50, date: "2025-01-27", category: "Dining", rawDescription: "STARBUCKS STORE 12345" },
  { id: "3", merchant: "Spotify", amount: 10.99, date: "2025-01-26", category: "Subscriptions", rawDescription: "SPOTIFY USA" },
  { id: "4", merchant: "Whole Foods", amount: 87.23, date: "2025-01-26", category: "Groceries", rawDescription: "WHOLE FOODS MARKET" },
  { id: "5", merchant: "Amazon Prime", amount: 14.99, date: "2025-01-25", category: "Subscriptions", rawDescription: "AMAZON PRIME MEMBERSHIP" },
  { id: "6", merchant: "Chipotle", amount: 12.45, date: "2025-01-25", category: "Dining", rawDescription: "CHIPOTLE 1234" },
  { id: "7", merchant: "Electric Co", amount: 89.00, date: "2025-01-24", category: "Utilities", rawDescription: "ELECTRIC COMPANY BILL" },
  { id: "8", merchant: "Coffee Shop", amount: 4.25, date: "2025-01-24", category: "Dining", rawDescription: "LOCAL COFFEE SHOP" },
  { id: "9", merchant: "Hulu", amount: 12.99, date: "2025-01-23", category: "Entertainment", rawDescription: "HULU SVCS" },
  { id: "10", merchant: "Shell Gas", amount: 52.00, date: "2025-01-22", category: "Transportation", rawDescription: "SHELL OIL 12345678" },
  { id: "11", merchant: "Gym Membership", amount: 29.99, date: "2025-01-21", category: "Subscriptions", rawDescription: "FITNESS GYM MONTHLY" },
  { id: "12", merchant: "Trader Joe's", amount: 43.12, date: "2025-01-20", category: "Groceries", rawDescription: "TRADER JOES #123" },
  { id: "13", merchant: "Apple iCloud", amount: 2.99, date: "2025-01-19", category: "Subscriptions", rawDescription: "APPLE.COM/BILL" },
  { id: "14", merchant: "Pizza Place", amount: 28.50, date: "2025-01-18", category: "Dining", rawDescription: "PIZZA PLACE DELIVERY" },
  { id: "15", merchant: "Internet Provider", amount: 69.99, date: "2025-01-17", category: "Utilities", rawDescription: "INTERNET MONTHLY" },
];

export const MOCK_SUBSCRIPTIONS: Subscription[] = [
  { id: "s1", name: "Netflix", amount: 15.99, frequency: "monthly", nextDue: "2025-02-28", category: "Entertainment" },
  { id: "s2", name: "Spotify", amount: 10.99, frequency: "monthly", nextDue: "2025-02-26", category: "Subscriptions" },
  { id: "s3", name: "Amazon Prime", amount: 14.99, frequency: "monthly", nextDue: "2025-02-25", category: "Subscriptions" },
  { id: "s4", name: "Hulu", amount: 12.99, frequency: "monthly", nextDue: "2025-02-23", category: "Entertainment" },
  { id: "s5", name: "Gym", amount: 29.99, frequency: "monthly", nextDue: "2025-02-21", category: "Subscriptions" },
  { id: "s6", name: "Apple iCloud", amount: 2.99, frequency: "monthly", nextDue: "2025-02-19", category: "Subscriptions" },
];

export function getTransactions(): Transaction[] {
  return [...MOCK_TRANSACTIONS].sort((a, b) => b.date.localeCompare(a.date));
}

export function getSubscriptions(): Subscription[] {
  return [...MOCK_SUBSCRIPTIONS];
}
