/**
 * world/parcels.js — parcel subdivision + building footprints (STUB).
 * Will turn StreetGraph + settlement bbox into Parcel[] and BuildingFootprint[].
 * See docs/STREETS_SPEC.md §5 Steps 2-3.
 */
export function subdivideParcels(streetGraph, bbox, buildingCount, seed) {
  // TODO: strip subdivision, inset, doorDir
  return [];
}
export function footprintsFromParcels(parcels, archetype, seed) {
  // TODO: pick type by archetype/buildingCount, create {x,y,type,polygon,doorDir}
  return [];
}
