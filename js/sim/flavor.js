/**
 * Sortie radio — the CDL never says what it is doing.
 * Lines are deterministic from a seed so the same raid always talks the same way.
 */

const PLACE_KIND = {
  town: 'MARKET TOWN',
  village: 'VILLAGE',
  compound: 'COMPOUND',
  farm: 'FARM',
  roadside_service: 'ROADSIDE',
  fuel_depot: 'FUEL YARD',
  industrial_depot: 'DEPOT',
  oil_field: 'OIL FIELD',
  checkpoint: 'CHECKPOINT',
  camp: 'GARRISON',
  sam_site: 'SAM SITE',
};

function pick(list, seed) {
  if (!list?.length) return '';
  const n = Math.abs(seed | 0) % list.length;
  return list[n];
}

function hashLabel(text) {
  let h = 2166136261;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function placeKindLabel(place) {
  if (!place) return 'SITE';
  return (
    PLACE_KIND[place.kind] ||
    String(place.kind || 'SITE')
      .replace(/_/g, ' ')
      .toUpperCase()
  );
}

export function discoveryLine(place) {
  if (!place) return '';
  const kind = placeKindLabel(place);
  const name = place.name || kind;
  if (place.kind === 'fuel_depot') return `${name}  ·  HIT TANKS FOR TIME`;
  return `${name}  ·  ${kind}`;
}

export function securedLine(encounter) {
  return pick(
    ['ZONE LIBERATED', 'THREAT REDUCED', 'FREEDOM INDEX UPDATED', 'NO POPULATION FOUND'],
    hashLabel(encounter?.id || 'contact')
  );
}

export function casualtyLine() {
  return 'NO CASUALTIES REPORTED';
}
