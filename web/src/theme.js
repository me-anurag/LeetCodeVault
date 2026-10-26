import { useSyncExternalStore } from 'react'

// Phones get the minimal reader UI; wider screens get the desktop layout. Both use the same light theme.
const phoneQuery = window.matchMedia('(max-width: 767px)')

const apply = () => document.documentElement.classList.toggle('phone', phoneQuery.matches)

apply()
phoneQuery.addEventListener('change', apply)

const subscribe = (cb) => {
  phoneQuery.addEventListener('change', cb)
  return () => phoneQuery.removeEventListener('change', cb)
}

export const useIsPhone = () => useSyncExternalStore(subscribe, () => phoneQuery.matches)
