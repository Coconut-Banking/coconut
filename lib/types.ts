export interface Transaction {
  id: string;
  merchant: string;
  amount: number;
  date: string;
  category: string;
  rawDescription: string;
}

export interface Subscription {
  id: string;
  name: string;
  amount: number;
  frequency: "monthly" | "yearly";
  nextDue: string;
  category: string;
}
