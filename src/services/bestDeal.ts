import { collection, getDocs } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';

export interface RatedProduct {
  id: string;
  providerId: string;
  name: string;
  price: number;
  category: string;
  condition: string;
  qualityScore: number;
  trustScore: number;
  brand?: string;
  latitude?: number;
  longitude?: number;
  badge?: string;
  distance?: number; // Calculated dynamically on read
}

// Distance helper using Haversine formula
export function getDistanceInKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Radius of the Earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return parseFloat((R * c).toFixed(2));
}

/**
 * Ranks a list of products based on location and metrics.
 * Generates categories like: "Best Deal", "Most Trusted", "Best Quality", "Closest Provider"
 */
export async function computeBestDeals(userLat: number = -6.8184, userLon: number = 39.2826): Promise<{
  bestDeal: RatedProduct | null;
  mostTrusted: RatedProduct | null;
  bestQuality: RatedProduct | null;
  closest: RatedProduct | null;
  all: RatedProduct[];
}> {
  const path = 'products';
  try {
    const productsSnapshot = await getDocs(collection(db, 'products'));
    const providersSnapshot = await getDocs(collection(db, 'providers'));
    
    // Map providers by ID for swift joins
    const providerMap = new Map<string, any>();
    providersSnapshot.forEach(docSnap => {
      providerMap.set(docSnap.id, docSnap.data());
    });

    const products: RatedProduct[] = [];
    productsSnapshot.forEach(docSnap => {
      const data = docSnap.data();
      const provider = providerMap.get(data.providerId);
      
      // Only include approved products from approved providers
      if (!provider || provider.status !== 'approved' || data.status !== 'approved') {
        return;
      }
      
      const lat = provider.latitude || -6.8184;
      const lon = provider.longitude || 39.2826;
      const dist = getDistanceInKm(userLat, userLon, lat, lon);

      products.push({
        id: docSnap.id,
        providerId: data.providerId,
        name: data.name,
        price: data.price,
        category: data.category || 'General',
        condition: data.condition || 'used',
        qualityScore: data.qualityScore || 80,
        trustScore: provider.trustScore || data.trustScore || 70,
        brand: data.brand || '',
        latitude: lat,
        longitude: lon,
        distance: dist,
        badge: data.badge || 'none'
      });
    });

    if (products.length === 0) {
      return {
        bestDeal: null,
        mostTrusted: null,
        bestQuality: null,
        closest: null,
        all: []
      };
    }

    // Sort by criteria to select champions
    // Best Deal: lowest price relative to quality/trust ratio (weighted score)
    const sortedByDeal = [...products].sort((a, b) => {
      const valA = (a.price / (a.qualityScore * (a.trustScore / 100)));
      const valB = (b.price / (b.qualityScore * (b.trustScore / 100)));
      return valA - valB;
    });

    // Most Trusted: highest trustScore
    const sortedByTrust = [...products].sort((a, b) => b.trustScore - a.trustScore);

    // Best Quality: highest qualityScore
    const sortedByQuality = [...products].sort((a, b) => b.qualityScore - a.qualityScore);

    // Closest: smallest distance
    const sortedByDistance = [...products].sort((a, b) => (a.distance || 0) - (b.distance || 0));

    // Dynamic Badge assignment for return
    const allRanks = products.map(p => {
      let b = 'none';
      if (p.id === sortedByDeal[0].id) b = 'Best Deal';
      else if (p.id === sortedByTrust[0].id) b = 'Most Trusted';
      else if (p.id === sortedByQuality[0].id) b = 'Best Quality';
      else if (p.id === sortedByDistance[0].id) b = 'Closest Provider';
      return { ...p, badge: b };
    });

    return {
      bestDeal: sortedByDeal[0] ? { ...sortedByDeal[0], badge: 'Best Deal' } : null,
      mostTrusted: sortedByTrust[0] ? { ...sortedByTrust[0], badge: 'Most Trusted' } : null,
      bestQuality: sortedByQuality[0] ? { ...sortedByQuality[0], badge: 'Best Quality' } : null,
      closest: sortedByDistance[0] ? { ...sortedByDistance[0], badge: 'Closest Provider' } : null,
      all: allRanks
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
    return { bestDeal: null, mostTrusted: null, bestQuality: null, closest: null, all: [] };
  }
}
