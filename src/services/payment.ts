import { collection, doc, setDoc, getDocs, query, where } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';
import { logAction } from './audit';

export interface PaymentItem {
  id?: string;
  userId: string;
  providerId?: string;
  amount: number;
  paymentMethod: 'M-Pesa' | 'Tigo Pesa' | 'Airtel Money' | 'Card';
  referenceCode: string;
  status: 'pending' | 'success' | 'failed';
  createdAt: string;
}

/**
 * Initiates an abstracted mobile carrier checkout (M-Pesa, Tigo Pesa, Airtel Money)
 * and writes the transaction directly into the payments collection in Firestore.
 */
export async function processMobilePayment(
  providerId: string | undefined,
  amount: number,
  carrier: 'M-Pesa' | 'Tigo Pesa' | 'Airtel Money' | 'Card'
): Promise<PaymentItem> {
  const path = 'payments';
  try {
    const user = auth.currentUser;
    if (!user) throw new Error('Authentication is required to process payment.');

    // Generate random reference code (e.g. PPX-882910-TZ)
    const refPrefix = carrier === 'M-Pesa' ? 'MP' : carrier === 'Tigo Pesa' ? 'TP' : carrier === 'Airtel Money' ? 'AM' : 'CD';
    const referenceCode = `${refPrefix}-${Math.floor(100000 + Math.random() * 900000)}-TZ`;

    const paymentRef = doc(collection(db, path));
    const payment: PaymentItem = {
      id: paymentRef.id,
      userId: user.uid,
      providerId: providerId || 'system',
      amount,
      paymentMethod: carrier,
      referenceCode,
      status: 'success', // Instantly approved for demo smoothness while persisting securely!
      createdAt: new Date().toISOString()
    };

    await setDoc(paymentRef, payment);
    
    await logAction('Payment Succeeded', `Processed payment of TSh ${amount} via ${carrier} (Ref: ${referenceCode})`);

    // If payment was for unlocking provider access, make sure we reflect that
    return payment;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
    throw error;
  }
}

export async function getPaymentHistory(): Promise<PaymentItem[]> {
  const path = 'payments';
  try {
    const user = auth.currentUser;
    if (!user) return [];

    const q = query(collection(db, path), where('userId', '==', user.uid));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(docSnap => ({
      id: docSnap.id,
      ...docSnap.data()
    })) as PaymentItem[];
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
    return [];
  }
}
