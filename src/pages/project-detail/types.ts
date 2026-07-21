export interface Payment {
  id: string;
  amount: number;
  detail: string;
  date: any;
  type: 'partial' | 'total';
  method?: 'caja_efectivo' | 'otro';
  cashAccount?: 'general' | 'personal';
  cashBoxLabel?: string;
  createdByEmail?: string;
  createdBy?: string;
  createdByName?: string;
  createdByRole?: string;
  paidByEmail?: string;
  paidByName?: string;
  cashMovementId?: string;
  receipt?: {
    fileName: string;
    originalFileName: string;
    url: string;
    path: string;
    contentType: string;
    size: number;
    uploadedAt: any;
    uploadedBy: string;
  } | null;
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
  paymentDate?: string;
  paymentHistory?: Payment[];
  paymentLocked?: boolean;
  paymentAuthorIds?: string[];
  createdBy?: string;
  createdByEmail?: string;
  invoice?: any;
  invoices?: any[];
  invoiceStatus?: string | null;
  otherReceipts?: Array<any>;
  sourceBudgetItemId?: string;
  order: number;
  createdAt: any;
  updatedAt?: any;
}

export interface AreaExpense extends Omit<BudgetItem, 'order'> {
  subcategory?: string;
  order?: number;
  invoice?: any;
  invoices?: any[];
  invoiceStatus?: string | null;
  otherReceipts?: Array<{
    id: string;
    fileName: string;
    originalFileName: string;
    url: string;
    path: string;
    contentType: string;
    size: number;
    uploadedAt: any;
    uploadedBy: string;
    uploadedByEmail?: string;
    uploadedByName?: string;
    uploadedByRole?: Collaborator['role'] | 'admin' | 'colaborador' | string;
  }>;
}

export type PaymentCollection = 'budgetItems' | 'areaExpenses';

export interface CashMovement {
  id: string;
  type: 'entrega' | 'transferencia' | 'pago';
  amount: number;
  cashAccount?: 'general' | 'personal';
  date: any;
  fromUserEmail?: string;
  fromUserName?: string;
  toUserId?: string;
  toUserEmail?: string;
  toUserName?: string;
  area?: string;
  subcategory?: string;
  collectionName?: PaymentCollection;
  itemId?: string;
  paymentId?: string;
  description?: string;
  notes?: string;
  createdByEmail?: string;
  createdBy?: string;
  createdByName?: string;
  status?: 'pending' | 'confirmed';
  confirmedAt?: any;
  confirmedBy?: string;
  confirmedByEmail?: string;
  confirmedByName?: string;
  createdAt?: any;
  updatedAt?: any;
}

export interface Collaborator {
  uid?: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  role: 'admin' | 'jefe_produccion' | 'jefe_area';
  allowedTabs: string[];
  allowedCategories: string[];
  allowedSubcategories?: string[];
  canEditBudgetAreas?: boolean;
  canViewBudgetTotals?: boolean;
  createdAt?: any;
  updatedAt?: any;
}
