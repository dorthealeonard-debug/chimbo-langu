import { collection, addDoc, getDocs, query, where, updateDoc, doc } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';

export interface NotificationItem {
  id?: string;
  userId: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

/**
 * Sends/stores a notification securely in Firestore
 */
export async function sendNotification(userId: string, title: string, body: string): Promise<string> {
  const path = 'notifications';
  try {
    const notif: NotificationItem = {
      userId,
      title,
      body,
      read: false,
      createdAt: new Date().toISOString()
    };
    const docRef = await addDoc(collection(db, path), notif);
    
    // Also trigger system/SMS console logging (SMS ready queue)
    console.log(`[OUTGOING SMS/EMAIL QUEUE TRIGGERED] To: UserID ${userId} | Title: ${title} | Body: ${body}`);
    
    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
    throw error;
  }
}

export async function getNotifications(): Promise<NotificationItem[]> {
  const path = 'notifications';
  try {
    const user = auth.currentUser;
    if (!user) return [];

    const q = query(
      collection(db, path),
      where('userId', '==', user.uid)
    );
    const snapshot = await getDocs(q);
    const notifications = snapshot.docs.map(docSnap => ({
      id: docSnap.id,
      ...docSnap.data()
    })) as NotificationItem[];

    // Sort by createdAt descending and limit to 20 in-memory to bypass index requirements
    return notifications
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 20);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
    return [];
  }
}

export async function markNotificationAsRead(notifId: string): Promise<void> {
  const path = `notifications/${notifId}`;
  try {
    const notifRef = doc(db, 'notifications', notifId);
    await updateDoc(notifRef, { read: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}
