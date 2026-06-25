import { collection, doc, getDoc, getDocs, setDoc, query, where } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { logAction } from './audit';

export interface TrustScoreDetails {
  id: string; // providerId
  score: number;
  documentsPoints: number;
  locationPoints: number;
  reviewsPoints: number;
  accuracyPoints: number;
  activityPoints: number;
  complaintsPenalty: number;
  recomputedAt: string;
}

/**
 * Recalculates the Trust Score for a provider and updates it securely in the database.
 */
export async function recalculateTrustScore(providerId: string): Promise<TrustScoreDetails> {
  const path = `trustScores/${providerId}`;
  try {
    // 1. Fetch Verification Documents
    const docsQ = query(collection(db, 'verificationDocuments'), where('providerId', '==', providerId));
    const docsSnapshot = await getDocs(docsQ);
    let documentsPoints = 0;
    docsSnapshot.forEach(docSnap => {
      const docData = docSnap.data();
      if (docData.status === 'approved') {
        if (docData.type === 'BRELA') documentsPoints += 10;
        if (docData.type === 'TIN') documentsPoints += 10;
        if (docData.type === 'Business License') documentsPoints += 10;
      }
    });
    // Cap document points to max 30
    if (documentsPoints > 30) documentsPoints = 30;

    // 2. Fetch Field Assignments (checking if verified matches actual)
    const assignQ = query(collection(db, 'fieldAssignments'), where('providerId', '==', providerId), where('status', '==', 'completed'));
    const assignSnapshot = await getDocs(assignQ);
    let locationPoints = 0;
    
    for (const assignment of assignSnapshot.docs) {
      const reportsQ = query(collection(db, 'fieldReports'), where('assignmentId', '==', assignment.id));
      const reportsSnapshot = await getDocs(reportsQ);
      reportsSnapshot.forEach(repSnap => {
        if (repSnap.data().isActualMatch === true) {
          locationPoints = 25; // Matching GPS location grants 25 points!
        }
      });
    }

    // 3. Fetch Complaints/Reports (Penalty points)
    const reportsQ = query(collection(db, 'reports'), where('providerId', '==', providerId));
    const reportsSnapshot = await getDocs(reportsQ);
    let complaintsPenalty = 0;
    reportsSnapshot.forEach(repSnap => {
      const data = repSnap.data();
      if (data.status === 'valid' || data.urgency === 'high') {
        complaintsPenalty += 10; // Minus 10 points for each valid severe complaint
      }
    });

    // 4. Default baseline ratings for newly registered providers
    const reviewsPoints = 15; // default high-quality initial score
    const accuracyPoints = 15; // default high-accuracy
    const activityPoints = 15; // default activity baseline

    // Compute aggregate score
    let score = documentsPoints + locationPoints + reviewsPoints + accuracyPoints + activityPoints - complaintsPenalty;
    if (score > 100) score = 100;
    if (score < 0) score = 0;

    const scoreDetails: TrustScoreDetails = {
      id: providerId,
      score,
      documentsPoints,
      locationPoints,
      reviewsPoints,
      accuracyPoints,
      activityPoints,
      complaintsPenalty,
      recomputedAt: new Date().toISOString()
    };

    // Save to Firestore
    await setDoc(doc(db, 'trustScores', providerId), scoreDetails);
    
    // Also update provider trustScore cache
    const providerRef = doc(db, 'providers', providerId);
    const providerSnap = await getDoc(providerRef);
    if (providerSnap.exists()) {
      await setDoc(providerRef, { ...providerSnap.data(), trustScore: score }, { merge: true });
    }

    await logAction('Trust Score Recalculated', `Recalculated trust score for provider ${providerId} to be ${score}/100.`);

    return scoreDetails;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
    throw error;
  }
}
