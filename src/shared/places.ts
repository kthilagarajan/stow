// Folders kept in the sidebar: the ones reached with Go to folder, newest first.
// A folder already listed keeps its place, so the list holds still while the person moves between them.
export interface Place {
  path: string
  name: string
}

export const MAX_PLACES = 10

export function addPlace(places: Place[], place: Place, max = MAX_PLACES): Place[] {
  if (places.some((entry) => entry.path === place.path)) return places
  return [place, ...places].slice(0, max)
}

export function removePlace(places: Place[], filePath: string): Place[] {
  return places.filter((entry) => entry.path !== filePath)
}

// Stored lists come from this window's storage, so anything malformed is dropped rather than trusted.
export function readPlaces(raw: string | null): Place[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((entry): entry is Place => typeof entry?.path === 'string' && typeof entry?.name === 'string' && entry.path.startsWith('/'))
      .slice(0, MAX_PLACES)
  } catch {
    return []
  }
}
