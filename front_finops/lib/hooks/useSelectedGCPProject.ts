"use client"

import { useCallback, useSyncExternalStore } from "react"

const STORAGE_KEY = "sia-finops.gcpSelectedProject"

// Small in-tab pub/sub so multiple mounted consumers stay in sync
// without waiting for the `storage` event (which only fires cross-tab).
const listeners = new Set<() => void>()

function read(): string {
  if (typeof window === "undefined") return ""
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? ""
  } catch {
    return ""
  }
}

function subscribe(callback: () => void) {
  listeners.add(callback)
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) callback()
  }
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(callback)
    window.removeEventListener("storage", onStorage)
  }
}

/**
 * Shared, persistent GCP project selection.
 * Backed by localStorage; syncs across mounted consumers in the same tab
 * and across other tabs via the native `storage` event.
 */
export function useSelectedGCPProject(): [string, (id: string) => void] {
  const value = useSyncExternalStore(
    subscribe,
    read,
    () => "", // SSR snapshot
  )

  const set = useCallback((id: string) => {
    try {
      if (id) window.localStorage.setItem(STORAGE_KEY, id)
      else window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore quota / private mode */
    }
    for (const l of listeners) l()
  }, [])

  return [value, set]
}
