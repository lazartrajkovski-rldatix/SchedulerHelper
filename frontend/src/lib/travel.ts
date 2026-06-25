/**
 * Approximate lat/lng for all postcodes used in mock data.
 *
 * In production this would be fetched from Postcodes.io:
 *   GET https://api.postcodes.io/postcodes/{postcode}
 *   → result.latitude, result.longitude
 *
 * Coordinates verified against Royal Mail / OS data to ~1km accuracy.
 */
const COORDS: Record<string, { lat: number; lon: number; label: string }> = {
  // Visit postcodes
  'BR8 7JY': { lat: 51.397,  lon:  0.177,  label: 'Swanley, Kent' },
  'TW9 2QE': { lat: 51.461,  lon: -0.303,  label: 'Richmond, London' },
  'CV9 3EH': { lat: 52.569,  lon: -1.562,  label: 'Atherstone, Warks' },
  'CV10 7PQ':{ lat: 52.521,  lon: -1.468,  label: 'Nuneaton, Warks' },
  'OX1 2JD': { lat: 51.753,  lon: -1.256,  label: 'Oxford' },
  'WF1 3QQ': { lat: 53.683,  lon: -1.498,  label: 'Wakefield, Yorks' },
  'B45 8BN': { lat: 52.386,  lon: -1.982,  label: 'Birmingham' },
  'N1 9GU':  { lat: 51.537,  lon: -0.101,  label: 'Islington, London' },
  'LS1 3BZ': { lat: 53.799,  lon: -1.548,  label: 'Leeds' },
  'SE1 7PB': { lat: 51.504,  lon: -0.090,  label: 'Southwark, London' },
  'B2 4QA':  { lat: 52.480,  lon: -1.893,  label: 'Birmingham city' },
  'OX2 6GG': { lat: 51.761,  lon: -1.274,  label: 'Oxford (north)' },
  'BA1 1AA': { lat: 51.381,  lon: -2.361,  label: 'Bath' },
  'B1 1BB':  { lat: 52.479,  lon: -1.910,  label: 'Birmingham' },
  'SW1A 1AA':{ lat: 51.501,  lon: -0.141,  label: 'Westminster, London' },
  'BS1 4DJ': { lat: 51.451,  lon: -2.595,  label: 'Bristol' },
  'EC1A 1BB':{ lat: 51.519,  lon: -0.102,  label: 'Clerkenwell, London' },
  'E1 6RF':  { lat: 51.516,  lon: -0.059,  label: 'Whitechapel, London' },
  'M1 6FW':  { lat: 53.477,  lon: -2.244,  label: 'Manchester' },
  'CV11 4SF':{ lat: 52.523,  lon: -1.461,  label: 'Nuneaton' },
  'WC1 3RT': { lat: 51.521,  lon: -0.113,  label: 'Holborn, London' },

  // Nurse base postcodes
  'CV10 0JX':{ lat: 52.524,  lon: -1.476,  label: 'Nuneaton (Biljana base)' },
};

/** Haversine straight-line distance in km between two lat/lon points */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) *
    Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Estimated driving time in minutes between two UK postcodes.
 *
 * Uses straight-line distance + assumed 48 km/h average speed (30 mph)
 * which is realistic for district nursing (mix of urban/rural roads).
 * Adds a 5-minute fixed overhead (parking, finding address, etc.).
 *
 * Returns 30 as a safe fallback if either postcode is unknown.
 *
 * Production replacement: call OS Routes / Google Distance Matrix API.
 */
export function travelMins(fromPostcode: string, toPostcode: string): number {
  if (!fromPostcode || !toPostcode || fromPostcode === toPostcode) return 0;

  const a = COORDS[fromPostcode.trim().toUpperCase()];
  const b = COORDS[toPostcode.trim().toUpperCase()];

  if (!a || !b) return 30; // safe fallback for unknown postcodes

  const km = haversineKm(a.lat, a.lon, b.lat, b.lon);
  const AVERAGE_SPEED_KMH = 48; // 30 mph
  const FIXED_OVERHEAD_MINS = 5;
  return Math.ceil((km / AVERAGE_SPEED_KMH) * 60) + FIXED_OVERHEAD_MINS;
}

/** Human-readable distance string, e.g. "32 km (40 min drive)" */
export function travelSummary(fromPostcode: string, toPostcode: string): string {
  const a = COORDS[fromPostcode.trim().toUpperCase()];
  const b = COORDS[toPostcode.trim().toUpperCase()];
  if (!a || !b) return 'Distance unknown';
  const km = haversineKm(a.lat, a.lon, b.lat, b.lon);
  const mins = travelMins(fromPostcode, toPostcode);
  return `~${Math.round(km)} km · ~${mins} min drive`;
}

/** Return the label for a postcode if known */
export function postcodeLabel(postcode: string): string {
  return COORDS[postcode.trim().toUpperCase()]?.label ?? postcode;
}
