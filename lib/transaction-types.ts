export interface UITransaction {
  id: string;
  dbId?: string;
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
  isPending?: boolean;
}
