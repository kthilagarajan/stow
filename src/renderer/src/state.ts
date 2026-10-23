import type { SavedScan, ScanEvent, StorageItem, VolumeInfo } from '@shared/types'
import { applyTrash, clearTrash, freedBytes } from '@shared/items'

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
  actionError: null
}

export type Action =
  | { type: 'volume'; volume: VolumeInfo }
  | { type: 'volume-error'; message: string }
  | { type: 'meta'; version: string }
  | { type: 'saved'; scan: SavedScan | null }
  | { type: 'emptied-trash' }
  | { type: 'event'; event: ScanEvent }
  | { type: 'trashed'; path: string }
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
      if (state.scanning || state.scannedAt !== null) return state
      if (!action.scan) {
        return { ...state, scanning: false, done: false, items: [], scannedAt: null, status: 'Scan when you are ready' }
      }
      return {
        ...state,
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
      const bytes = freedBytes(state.items, action.path)
      const volume = state.volume
        ? {
            ...state.volume,
            usedBytes: Math.max(0, state.volume.usedBytes - bytes),
            freeBytes: state.volume.freeBytes + bytes
          }
        : null
      return { ...state, items: applyTrash(state.items, action.path), volume, actionError: null }
    }
    case 'event':
      return applyEvent(state, action.event)
    default:
      return state
  }
}
