import type { ScanEvent, StorageItem, VolumeInfo } from '@shared/types'

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
  actionError: string | null
}

export const initialState: AppState = {
  volume: null,
  volumeError: null,
  items: [],
  scanning: false,
  done: false,
  status: 'Reading the disk',
  completed: 0,
  total: 0,
  limited: 0,
  actionError: null
}

function freedBytes(items: StorageItem[], target: string): number {
  for (const item of items) {
    if (item.path === target) return item.bytes
    const child = item.children.find((entry) => entry.path === target)
    if (child) return child.bytes
  }
  return 0
}

export function applyTrash(items: StorageItem[], target: string): StorageItem[] {
  const bytes = freedBytes(items, target)
  return items.flatMap((item) => {
    if (item.path === target) return []
    const child = item.children.find((entry) => entry.path === target)
    if (child) {
      const children = item.children.filter((entry) => entry.path !== target)
      if (item.id === 'node-modules' && children.length === 0) return []
      return [{ ...item, children, bytes: Math.max(0, item.bytes - child.bytes) }]
    }
    if (!item.shadow && item.path && target.startsWith(`${item.path}/`)) {
      return [{ ...item, bytes: Math.max(0, item.bytes - bytes) }]
    }
    return [item]
  })
}

export type Action =
  | { type: 'volume'; volume: VolumeInfo }
  | { type: 'volume-error'; message: string }
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
