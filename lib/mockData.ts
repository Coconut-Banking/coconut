export interface Transaction {
  id: string;
  merchant: string;
  rawDescription: string;
  amount: number;
  category: string;
  categoryColor: string;
  date: string;
  dateStr: string;
  isRecurring: boolean;
  hasSplitSuggestion: boolean;
  splitWith?: string;
  location?: string;
  merchantColor: string;
}

export const transactions: Transaction[] = [
  {
    id: "t1",
    merchant: "Netflix",
    rawDescription: "NETFLIX.COM 866-716-0414 CA US",
    amount: -15.99,
    category: "Entertainment",
    categoryColor: "bg-purple-100 text-purple-700",
    date: "2026-03-01",
    dateStr: "Mar 1",
    isRecurring: true,
    hasSplitSuggestion: false,
    location: "Los Gatos, CA",
    merchantColor: "#E50914",
  },
  {
    id: "t2",
    merchant: "Uber",
    rawDescription: "UBER* TRIP HELP.UBER.COM CA",
    amount: -23.40,
    category: "Transport",
    categoryColor: "bg-blue-100 text-blue-700",
    date: "2026-02-28",
    dateStr: "Feb 28",
    isRecurring: false,
    hasSplitSuggestion: true,
    splitWith: "Alex",
    location: "San Francisco, CA",
    merchantColor: "#000000",
  },
  {
    id: "t3",
    merchant: "Whole Foods Market",
    rawDescription: "WFM SAN FRANCISCO CA 94103",
    amount: -87.32,
    category: "Groceries",
    categoryColor: "bg-emerald-100 text-emerald-700",
    date: "2026-02-27",
    dateStr: "Feb 27",
    isRecurring: false,
    hasSplitSuggestion: false,
    location: "San Francisco, CA",
    merchantColor: "#00674B",
  },
  {
    id: "t4",
    merchant: "Spotify",
    rawDescription: "SPOTIFY P1234ABC567 NY",
    amount: -9.99,
    category: "Entertainment",
    categoryColor: "bg-purple-100 text-purple-700",
    date: "2026-02-26",
    dateStr: "Feb 26",
    isRecurring: true,
    hasSplitSuggestion: false,
    location: "New York, NY",
    merchantColor: "#1DB954",
  },
  {
    id: "t5",
    merchant: "SoulCycle",
    rawDescription: "SOULCYCLE SAN FRANCISCO CA",
    amount: -30.00,
    category: "Health & Fitness",
    categoryColor: "bg-pink-100 text-pink-700",
    date: "2026-02-25",
    dateStr: "Feb 25",
    isRecurring: false,
    hasSplitSuggestion: false,
    location: "San Francisco, CA",
    merchantColor: "#FFD700",
  },
  {
    id: "t6",
    merchant: "Apple iCloud",
    rawDescription: "APPLE.COM/BILL 866-712-7753 CA",
    amount: -2.99,
    category: "Utilities",
    categoryColor: "bg-gray-100 text-gray-700",
    date: "2026-02-24",
    dateStr: "Feb 24",
    isRecurring: true,
    hasSplitSuggestion: false,
    location: "Cupertino, CA",
    merchantColor: "#555555",
  },
  {
    id: "t7",
    merchant: "Shake Shack",
    rawDescription: "SHAKE SHACK 1234 SAN FRANCISCO CA",
    amount: -18.50,
    category: "Dining",
    categoryColor: "bg-orange-100 text-orange-700",
    date: "2026-02-23",
    dateStr: "Feb 23",
    isRecurring: false,
    hasSplitSuggestion: true,
    splitWith: "Jordan",
    location: "San Francisco, CA",
    merchantColor: "#7BB848",
  },
  {
    id: "t8",
    merchant: "Amazon",
    rawDescription: "AMZN MKTP US*1A2B3C4D5",
    amount: -54.99,
    category: "Shopping",
    categoryColor: "bg-amber-100 text-amber-700",
    date: "2026-02-22",
    dateStr: "Feb 22",
    isRecurring: false,
    hasSplitSuggestion: false,
    location: "Seattle, WA",
    merchantColor: "#FF9900",
  },
  {
    id: "t9",
    merchant: "Sweetgreen",
    rawDescription: "SWEETGREEN SAN FRANCISCO CA 94107",
    amount: -14.80,
    category: "Dining",
    categoryColor: "bg-orange-100 text-orange-700",
    date: "2026-02-21",
    dateStr: "Feb 21",
    isRecurring: false,
    hasSplitSuggestion: false,
    location: "San Francisco, CA",
    merchantColor: "#006B3F",
  },
  {
    id: "t10",
    merchant: "Delta Airlines",
    rawDescription: "DELTA AIR 00623456789012 ATLANTA GA",
    amount: -320.00,
    category: "Travel",
    categoryColor: "bg-cyan-100 text-cyan-700",
    date: "2026-02-20",
    dateStr: "Feb 20",
    isRecurring: false,
    hasSplitSuggestion: true,
    splitWith: "Sam",
    location: "Atlanta, GA",
    merchantColor: "#003366",
  },
];

export interface Subscription {
  id: string;
  merchant: string;
  amount: number;
  lastCharged: string;
  nextCharge: string;
  trend: "stable" | "up" | "down";
  trendPercent?: number;
  alert?: string;
  merchantColor: string;
  category: string;
}

export const subscriptions: Subscription[] = [
  {
    id: "s1",
    merchant: "Netflix",
    amount: 15.99,
    lastCharged: "Mar 1, 2026",
    nextCharge: "Apr 1, 2026",
    trend: "up",
    trendPercent: 20,
    alert: "Price increased 20%",
    merchantColor: "#E50914",
    category: "Entertainment",
  },
  {
    id: "s2",
    merchant: "Spotify",
    amount: 9.99,
    lastCharged: "Feb 26, 2026",
    nextCharge: "Mar 26, 2026",
    trend: "stable",
    merchantColor: "#1DB954",
    category: "Entertainment",
  },
  {
    id: "s3",
    merchant: "Apple iCloud",
    amount: 2.99,
    lastCharged: "Feb 24, 2026",
    nextCharge: "Mar 24, 2026",
    trend: "stable",
    merchantColor: "#555555",
    category: "Utilities",
  },
  {
    id: "s4",
    merchant: "ChatGPT Plus",
    amount: 20.00,
    lastCharged: "Feb 18, 2026",
    nextCharge: "Mar 18, 2026",
    trend: "stable",
    merchantColor: "#10A37F",
    category: "Productivity",
  },
  {
    id: "s5",
    merchant: "Adobe Creative Cloud",
    amount: 54.99,
    lastCharged: "Feb 15, 2026",
    nextCharge: "Mar 15, 2026",
    trend: "up",
    trendPercent: 8,
    alert: "Duplicate subscription detected",
    merchantColor: "#FF0000",
    category: "Productivity",
  },
  {
    id: "s6",
    merchant: "Notion",
    amount: 10.00,
    lastCharged: "Feb 10, 2026",
    nextCharge: "Mar 10, 2026",
    trend: "down",
    trendPercent: 50,
    merchantColor: "#000000",
    category: "Productivity",
  },
];

export interface SharedTransaction {
  id: string;
  merchant: string;
  amount: number;
  date: string;
  paidBy: string;
  splitWith: string[];
  yourShare: number;
  category: string;
  categoryColor: string;
  merchantColor: string;
}

export const sharedTransactions: SharedTransaction[] = [
  {
    id: "sh1",
    merchant: "Airbnb",
    amount: -480.00,
    date: "Feb 14",
    paidBy: "You",
    splitWith: ["Alex", "Sam", "Jordan"],
    yourShare: 120.00,
    category: "Travel",
    categoryColor: "bg-cyan-100 text-cyan-700",
    merchantColor: "#FF5A5F",
  },
  {
    id: "sh2",
    merchant: "Delta Airlines",
    amount: -320.00,
    date: "Feb 20",
    paidBy: "Sam",
    splitWith: ["You", "Alex"],
    yourShare: 106.67,
    category: "Travel",
    categoryColor: "bg-cyan-100 text-cyan-700",
    merchantColor: "#003366",
  },
  {
    id: "sh3",
    merchant: "Nobu Restaurant",
    amount: -240.00,
    date: "Feb 21",
    paidBy: "Alex",
    splitWith: ["You", "Sam", "Jordan"],
    yourShare: 60.00,
    category: "Dining",
    categoryColor: "bg-orange-100 text-orange-700",
    merchantColor: "#1A1A1A",
  },
  {
    id: "sh4",
    merchant: "Ski Rentals",
    amount: -160.00,
    date: "Feb 22",
    paidBy: "Jordan",
    splitWith: ["You", "Alex", "Sam"],
    yourShare: 40.00,
    category: "Activities",
    categoryColor: "bg-sky-100 text-sky-700",
    merchantColor: "#4A90D9",
  },
  {
    id: "sh5",
    merchant: "Grocery Run",
    amount: -87.50,
    date: "Feb 22",
    paidBy: "You",
    splitWith: ["Alex", "Sam", "Jordan"],
    yourShare: 21.88,
    category: "Groceries",
    categoryColor: "bg-emerald-100 text-emerald-700",
    merchantColor: "#00674B",
  },
];
