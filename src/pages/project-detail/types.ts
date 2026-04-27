export interface Payment {
  id: string;
  amount: number;
  detail: string;
  date: any;
  type: 'partial' | 'total';
}

export interface BudgetItem {
  id: string;
  projectId: string;
  area: string;
  providerId: string;
  providerName: string;
  description: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  total: number;
  paid?: boolean;
  paymentHistory?: Payment[];
  order: number;
  createdAt: any;
  updatedAt?: any;
}

export type PaymentCollection = 'budgetItems' | 'areaExpenses';

export interface Collaborator {
  email: string;
  role: 'admin' | 'colaborador';
  allowedTabs: string[];
  allowedCategories: string[];
}
