// Room codes: the public canvas, short random codes and user-named rooms all share
// one normalized namespace, so a code typed on a phone always maps to the same room.
export const PUBLIC_ROOM = 'public'

const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz' // no i/l/o: easy to read off a screen

export const normalizeCode = (raw) =>
  String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 24)

export function randomCode(length = 5) {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
}

const baseUrl = () => location.href.split(/[?#]/)[0]

export const painterUrl = (code) => `${baseUrl()}?c=${encodeURIComponent(code)}`
export const presentUrl = (code) => `${baseUrl()}?c=${encodeURIComponent(code)}&present`
export const homeUrl = () => baseUrl()
