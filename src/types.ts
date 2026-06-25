export interface RouteHistoryEntry {
  id: string;
  providerIds: string[];
  timestamp: string;
  totalDistance: number;
  totalDuration: number;
}

export interface UserProfile {
  id: string;
  name?: string;
  phoneNumber?: string;
  email?: string;
  role: 'customer' | 'provider' | 'staff' | 'admin' | 'superadmin' | 'field_officer' | 'support_officer' | 'verification_officer' | 'finance_officer' | 'moderator';
  createdAt: string;
  status?: string;
  trialExpiresAt?: string;
  passType?: 'free_trial' | 'daily' | 'weekly' | 'none';
  passExpiresAt?: string;
  routeHistory?: RouteHistoryEntry[];
  savedProviders?: string[];
}

export interface BusinessProvider {
  id: string;
  userId: string;
  businessName: string;
  category?: string;
  description?: string;
  tinNumber?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  trustScore?: number;
  isVerified?: boolean;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

export interface ListedProduct {
  id: string;
  providerId: string;
  name: string;
  category?: string;
  brand?: string;
  condition?: 'new' | 'used' | 'refurbished';
  price: number;
  description?: string;
  qualityScore?: number;
  trustScore?: number;
  isVerified?: boolean;
  badge?: 'none' | 'Best Deal' | 'Most Trusted' | 'Best Quality' | 'Closest';
  createdAt: string;
}

export interface ProductPhoto {
  id: string;
  productId: string;
  angle: 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'packaging';
  imageUrl: string;
  uploadedAt: string;
}

export interface OfferedService {
  id: string;
  providerId: string;
  name: string;
  category?: string;
  description?: string;
  startingPrice: number;
  minPrice?: number;
  maxPrice?: number;
  coverageAreas?: string[];
  isVerified?: boolean;
  createdAt: string;
}

export interface AccessPass {
  id: string;
  userId: string;
  providerId: string;
  itemId?: string;
  type?: 'product' | 'service';
  expiryDate: string;
  status: 'active' | 'expired';
  createdAt: string;
}

export interface PremiumSubscription {
  id: string;
  providerId: string;
  plan: 'starter' | 'business' | 'premium' | 'enterprise';
  price?: number;
  status: 'active' | 'expired';
  expiresAt: string;
  createdAt: string;
}

export interface BillingPayment {
  id: string;
  userId: string;
  amount: number;
  paymentMethod: 'M-Pesa' | 'Tigo Pesa' | 'Airtel Money' | 'Card';
  status: 'pending' | 'success' | 'failed';
  referenceCode?: string;
  createdAt: string;
}

export interface FraudReport {
  id: string;
  reporterId: string;
  providerId: string;
  productId?: string;
  reason: 'Fake Price' | 'Wrong Location' | 'Fake Product';
  description?: string;
  urgency: 'high' | 'med' | 'low';
  status: 'open' | 'investigated' | 'resolved';
  createdAt: string;
}
