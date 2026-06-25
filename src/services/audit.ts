import { collection, doc, setDoc, getDocs, orderBy, query, limit } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';

export interface AuditLogItem {
  id?: string;
  userId: string;
  userEmail: string;
  action: string;
  details: string;
  before?: string;
  after?: string;
  ip?: string;
  device?: string;
  timestamp: string;
}

export async function logAction(
  action: string,
  details: string,
  before: string = 'N/A',
  after: string = 'N/A'
): Promise<void> {
  const path = 'auditLogs';
  try {
    const user = auth.currentUser;
    if (!user) {
      console.log(`[AUDIT LOG GUEST] ${action}: ${details}`);
      return;
    }
    const logRef = doc(collection(db, path));
    const device = typeof navigator !== 'undefined' ? navigator.userAgent.substring(0, 290) : 'Server/Unknown';
    const ip = '127.0.0.1';
    
    const logData: AuditLogItem = {
      id: logRef.id,
      userId: user.uid,
      userEmail: user.email || 'System/Anonymous',
      action,
      details,
      before: before.substring(0, 3990),
      after: after.substring(0, 3990),
      ip,
      device,
      timestamp: new Date().toISOString()
    };
    await setDoc(logRef, logData);
    console.log(`[AUDIT LOG] ${action}: ${details}`);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function getAuditLogs(maxCount: number = 50): Promise<AuditLogItem[]> {
  const path = 'auditLogs';
  try {
    const q = query(collection(db, path), orderBy('timestamp', 'desc'), limit(maxCount));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as AuditLogItem[];
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
    return [];
  }
}
