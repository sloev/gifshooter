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
  $('present-name').value = randomCode()
}
