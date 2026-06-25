import { collection, doc, setDoc, getDocs } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';
import { RatedProduct, computeBestDeals } from './bestDeal';

export interface SearchFilters {
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  minTrust?: number;
  minQuality?: number;
  maxDistance?: number; // In km from user coordinate
}

/**
 * Searches and filters products and services using full-text matching and criteria thresholds.
 */
export async function searchCHIMBO(
  searchQuery: string,
  filters: SearchFilters = {},
  userLat: number = -6.8184,
  userLon: number = 39.2826
): Promise<RatedProduct[]> {
  const path = 'searches';
  try {
    // 1. Log query to searches log if signed in
    if (searchQuery.trim().length > 0 && auth.currentUser) {
      const searchRef = doc(collection(db, 'searches'));
      await setDoc(searchRef, {
        id: searchRef.id,
        userId: auth.currentUser.uid,
        query: searchQuery,
        timestamp: new Date().toISOString()
       });
    }

    // 2. Fetch computed ranked list
    const { all } = await computeBestDeals(userLat, userLon);
    
    // 3. Filter list programmatically based on criteria
    const lowerQuery = searchQuery.toLowerCase().trim();
    
    return all.filter(p => {
      // Query Match (Name, Category, or Brand)
      if (lowerQuery.length > 0) {
        const matchesName = p.name.toLowerCase().includes(lowerQuery);
        const matchesCategory = p.category.toLowerCase().includes(lowerQuery);
        const matchesBrand = (p.brand || '').toLowerCase().includes(lowerQuery);
        if (!matchesName && !matchesCategory && !matchesBrand) return false;
      }

      // Category filter
      if (filters.category && filters.category !== 'Zote' && p.category.toLowerCase() !== filters.category.toLowerCase()) {
        return false;
      }

      // Price filter
      if (filters.minPrice !== undefined && p.price < filters.minPrice) return false;
      if (filters.maxPrice !== undefined && p.price > filters.maxPrice) return false;

      // Trust Score filter
      if (filters.minTrust !== undefined && p.trustScore < filters.minTrust) return false;

      // Quality Score filter
      if (filters.minQuality !== undefined && p.qualityScore < filters.minQuality) return false;

      // Distance filter
      if (filters.maxDistance !== undefined && (p.distance || 0) > filters.maxDistance) return false;

      return true;
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
    return [];
  }
}
