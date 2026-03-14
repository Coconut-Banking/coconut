export interface UITransaction {
  id: string;
  dbId?: string;
  accountId?: string | null;
  accountMask?: string | null;
  accountName?: string | null;
  merchant: string;
  rawDescription: string;
  amount: number;
  isoCurrencyCode?: string;
  category: string;
  categoryColor: string;
  date: string;
  dateStr: string;
  isRecurring: boolean;
  hasSplitSuggestion: boolean;
  splitWith?: string;
  location?: string;
  merchantColor: string;
  isPending?: boolean;
}
