/**
 * Privacy and Access Control utility helpers for CHIMBO KARIAKOO.
 */

/**
 * Masks a provider's store name for guest users or locked providers.
 * Example: "JOHN STORE" -> "JO*** STORE"
 * Example: "MAMA SAMSUNG SHOP" -> "MA*** SAMSUNG SHOP"
 */
export function maskProviderName(name: string): string {
  if (!name) return '';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '';
  
  const firstWord = parts[0];
  let maskedFirst = '';
  if (firstWord.length <= 2) {
    maskedFirst = firstWord + '***';
  } else {
    maskedFirst = firstWord.substring(0, 2) + '***';
  }
  
  if (parts.length === 1) {
    return maskedFirst;
  }
  return [maskedFirst, ...parts.slice(1)].join(' ');
}

/**
 * Extracts only the general business area from a full address string.
 * Example: "Kariakoo, Aggrey Street, Plot 4" -> "Kariakoo"
 * Example: "Sinza, Shekilango Road" -> "Sinza"
 */
export function getGeneralArea(address: string): string {
  if (!address) return 'Kariakoo';
  const parts = address.split(',');
  if (parts.length === 0) return 'Kariakoo';
  return parts[0].trim();
}
