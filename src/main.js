import { PUBLIC_ROOM, normalizeCode, randomCode, painterUrl, presentUrl } from './rooms.js'

const params = new URLSearchParams(location.search)
const code = normalizeCode(params.get('c') ?? params.get('room'))

if (!code) {
  showLanding()
} else if (params.has('present') && params.get('present') !== 'false') {
  import('./present.js').then((m) => m.startPresent(code))
} else {
  import('./paint.js').then((m) => m.startPaint(code))
}

function showLanding() {
  const $ = (id) => document.getElementById(id)
  $('landing').hidden = false
  const fun = ['❤️', '💖', '💘', '💝', '💜', '🧡', '💛', '💚', '💙', '🩷', '✨', '🌈', '🦄', '🍩', '🪐', '🔥', '👾', '🎉', '🍄', '🌀']
  $('made-with').textContent = fun[Math.floor(Math.random() * fun.length)]
  const go = (url) => location.assign(url)

  $('join-form').onsubmit = (e) => {
    e.preventDefault()
    const c = normalizeCode($('join-code').value)
    if (c) go(painterUrl(c))
    else $('join-code').focus()
  }
  $('join-public').onclick = () => go(painterUrl(PUBLIC_ROOM))
  $('present-public').onclick = () => go(presentUrl(PUBLIC_ROOM))
  $('present-form').onsubmit = (e) => {
    e.preventDefault()
    const c = normalizeCode($('present-name').value)
    if (c) go(presentUrl(c))
    else $('present-name').focus()
  }
  suggestCode()
}

// Pre-fill the present field with a fresh 5-letter code that nobody is using, and tell
// the presenter whether a code they type is already taken.
async function suggestCode() {
  const { probeRoom } = await import('./net.js')
  const field = document.getElementById('present-name')
  const hint = document.getElementById('present-hint')
  let token = 0
  const say = (text, busy = false) => {
    hint.textContent = text
    hint.classList.toggle('busy', busy)
  }

  async function freshCode() {
    const mine = ++token
    for (let tries = 0; tries < 5; tries++) {
      const code = randomCode()
      field.value = code
      say('checking that this code is free…')
      const inUse = await probeRoom(code)
      if (mine !== token) return
      if (!inUse) return say('✓ fresh code, nobody is using it')
    }
    say('could not find a free code, try typing your own', true)
  }

  let typingTimer = 0
  field.addEventListener('input', () => {
    const mine = ++token
    clearTimeout(typingTimer)
    const code = normalizeCode(field.value)
    if (!code) return say('')
    if (code === PUBLIC_ROOM) return say('this is the public canvas')
    say('checking…')
    typingTimer = setTimeout(async () => {
      const inUse = await probeRoom(code)
      if (mine !== token) return
      say(inUse ? `“${code}” is in use, you'll share that canvas` : `✓ “${code}” is free`, inUse)
    }, 600)
  })

  freshCode()
}
