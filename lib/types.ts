export interface Transaction {
  id: string;
  merchant: string;
  amount: number;
  date: string;
  category: string;
  rawDescription: string;
}
