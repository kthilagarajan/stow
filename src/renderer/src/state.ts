import type { SavedScan, ScanEvent, StorageItem, VolumeInfo } from '@shared/types'
import { addToTrash, applyTrash, clearTrash, freedBytes } from '@shared/items'

export interface AppState {
  volume: VolumeInfo | null
  volumeError: string | null
  items: StorageItem[]
  scanning: boolean
  done: boolean
  status: string
  completed: number
  total: number
  limited: number
  scannedAt: number | null
  version: string | null
  actionError: string | null
  // False until the saved scan has been read, so the window can show placeholders instead of "nothing yet".
  loaded: boolean
}

export const initialState: AppState = {
  volume: null,
  volumeError: null,
  items: [],
  scanning: false,
  done: false,
  status: 'Opening the last scan',
  completed: 0,
  total: 0,
  limited: 0,
  scannedAt: null,
  version: null,
  actionError: null,
  loaded: false
}

export type Action =
  | { type: 'volume'; volume: VolumeInfo }
  | { type: 'volume-error'; message: string }
  | { type: 'meta'; version: string }
  | { type: 'saved'; scan: SavedScan | null }
  | { type: 'emptied-trash' }
  | { type: 'event'; event: ScanEvent }
  // `bytes` is the size known for the path; `inside` marks a path whose parent moved in the same batch.
  | { type: 'trashed'; path: string; bytes: number; inside: boolean }
  | { type: 'action-error'; message: string | null }

function applyEvent(state: AppState, event: ScanEvent): AppState {
  switch (event.type) {
    case 'start':
      return {
        ...state,
        items: [],
        scanning: true,
        done: false,
        limited: 0,
        completed: 0,
        total: event.total ?? 0,
        status: 'Starting the scan',
        actionError: null
      }
    case 'status':
      return {
        ...state,
        scanning: true,
        status: event.message ?? state.status,
        completed: event.completed ?? state.completed,
        total: event.total ?? state.total
      }
    case 'item':
      if (!event.item) return state
      return { ...state, items: [...state.items.filter((item) => item.id !== event.item?.id), event.item] }
    case 'done':
      return {
        ...state,
        scanning: false,
        done: true,
        limited: event.limited ?? 0,
        completed: event.completed ?? state.total,
        scannedAt: Date.now(),
        status: 'Scan finished'
      }
    case 'error':
      return {
        ...state,
        scanning: false,
        volumeError: event.message ?? 'The scan stopped.',
        status: 'Scan stopped'
      }
    default:
      return state
  }
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'volume':
      return { ...state, volume: action.volume, volumeError: null }
    case 'volume-error':
      return { ...state, volumeError: action.message }
    case 'meta':
      return { ...state, version: action.version }
    case 'emptied-trash': {
      const bytes = state.items.find((item) => item.id === 'trash')?.bytes ?? 0
      const volume = state.volume
        ? {
            ...state.volume,
            usedBytes: Math.max(0, state.volume.usedBytes - bytes),
            freeBytes: state.volume.freeBytes + bytes
          }
        : null
      return { ...state, items: clearTrash(state.items), volume, actionError: null }
    }
    case 'saved':
      if (state.scanning || state.scannedAt !== null) return { ...state, loaded: true }
      if (!action.scan) {
        return { ...state, loaded: true, scanning: false, done: false, items: [], scannedAt: null, status: 'Scan when you are ready' }
      }
      return {
        ...state,
        loaded: true,
        items: action.scan.items,
        done: true,
        scanning: false,
        limited: action.scan.limited,
        scannedAt: action.scan.scannedAt,
        status: 'Showing the last scan'
      }
    case 'action-error':
      return { ...state, actionError: action.message }
    case 'trashed': {
      // The disk does not get space back until the Trash is emptied, so only the Trash row grows.
      // A path inside a folder that moved in the same batch was already counted with that folder.
      if (action.inside) return state
      const bytes = freedBytes(state.items, action.path) || action.bytes
      return { ...state, items: addToTrash(applyTrash(state.items, action.path, action.bytes), bytes), actionError: null }
    }
    case 'event':
      return applyEvent(state, action.event)
    default:
      return state
  }
}
