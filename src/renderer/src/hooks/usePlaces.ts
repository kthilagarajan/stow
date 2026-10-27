import { useState } from 'react'
import { addPlace, readPlaces, removePlace, type Place } from '@shared/places'

const KEY = 'stow.places'

// The folders listed under Folders in the sidebar, kept in this window's storage.
export function usePlaces() {
  const [places, setPlaces] = useState<Place[]>(() => {
    try {
      return readPlaces(localStorage.getItem(KEY))
    } catch {
      return []
    }
  })

  function save(change: (existing: Place[]) => Place[]): void {
    setPlaces((existing) => {
      const next = change(existing)
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        // The list just won't outlive this window.
      }
      return next
    })
  }

  return {
    places,
    add: (place: Place) => save((existing) => addPlace(existing, place)),
    remove: (filePath: string) => save((existing) => removePlace(existing, filePath))
  }
}
