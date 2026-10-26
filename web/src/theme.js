import { useSyncExternalStore } from 'react'

// Phones get the minimal reader UI on a light "paper" background, whatever the system theme.
// Wider screens keep the desktop UI and follow the system light/dark setting.
const phoneQuery = window.matchMedia('(max-width: 767px)')
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')

const THEME_COLOR = { phone: '#f6f3ec', light: '#ffffff', dark: '#0a0a0a' }

function apply() {
  const phone = phoneQuery.matches
  const dark = !phone && darkQuery.matches
  const root = document.documentElement
  root.classList.toggle('phone', phone)
  root.classList.toggle('dark', dark)
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_COLOR[phone ? 'phone' : dark ? 'dark' : 'light'])
}

apply()
phoneQuery.addEventListener('change', apply)
darkQuery.addEventListener('change', apply)

const subscribe = (cb) => {
  phoneQuery.addEventListener('change', cb)
  return () => phoneQuery.removeEventListener('change', cb)
}

export const useIsPhone = () => useSyncExternalStore(subscribe, () => phoneQuery.matches)
