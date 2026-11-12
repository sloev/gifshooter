// Serverless signalling: Trystero over public Nostr relays (its default relay set),
// then plain WebRTC data channels between peers.
import { joinRoom, selfId, getRelaySockets } from 'trystero/nostr'

const APP_ID = 'gifshooter-v2'

export { selfId }

// Without WebRTC (some embedded browsers, WebKitGTK with it switched off) there is no
// way to connect; hand back an inert room so the page still renders and can say why.
const offlineRoom = () => {
  const action = () => ({ send: async () => {}, onMessage: null })
  return {
    offline: true,
    room: { onPeerJoin: null, onPeerLeave: null, leave: async () => {}, rejoin: async () => {} },
    hello: action(),
    cursor: action(),
  }
}

// The room handed to the app is a stable facade over a Trystero room that can be
// swapped out: rejoin() leaves and joins again, which makes this peer announce itself
// afresh (Trystero only re-announces every 60 s once it has settled).
export function connect(code) {
  if (typeof RTCPeerConnection === 'undefined') return offlineRoom()

  // Optional override for testing / when the default relays are blocked:
  //   ?relays=wss://relay.one,wss://relay.two
  const relays = new URLSearchParams(location.search).get('relays')
  const config = { appId: APP_ID }
  if (relays) config.relayConfig = { urls: relays.split(',').filter(Boolean) }

  const handlers = { onPeerJoin: null, onPeerLeave: null }
  const onMessage = { hello: null, cursor: null }
  let inner = null
  let actions = null

  const open = () => {
    inner = joinRoom(config, `canvas:${code}`)
    inner.onPeerJoin = (id) => handlers.onPeerJoin?.(id)
    inner.onPeerLeave = (id) => handlers.onPeerLeave?.(id)
    actions = {}
    for (const name of ['hello', 'cursor']) {
      actions[name] = inner.makeAction(name)
      actions[name].onMessage = (data, ctx) => onMessage[name]?.(data, ctx)
    }
  }
  open()
  watchRelays()

  let rejoining = null
  const room = {
    get onPeerJoin() {
      return handlers.onPeerJoin
    },
    set onPeerJoin(fn) {
      handlers.onPeerJoin = fn
    },
    get onPeerLeave() {
      return handlers.onPeerLeave
    },
    set onPeerLeave(fn) {
      handlers.onPeerLeave = fn
    },
    leave: () => inner.leave(),
    rejoin: () =>
      (rejoining ??= inner
        .leave()
        .catch(() => {})
        .then(open)
        .finally(() => (rejoining = null))),
  }
  const action = (name) => ({
    send: (data, opts) => (rejoining ? Promise.resolve() : actions[name].send(data, opts)),
    get onMessage() {
      return onMessage[name]
    },
    set onMessage(fn) {
      onMessage[name] = fn
    },
  })

  return {
    offline: false,
    room,
    // Screens announce themselves; painters announce nothing and just stream their cursor.
    hello: action('hello'),
    cursor: action('cursor'),
  }
}

// ---- relay watchdog ------------------------------------------------------------------
// Trystero has no heartbeat on its relay websockets. A connection that dies quietly
// (laptop Wi-Fi or a router dropping an idle connection) still reads as "open", and the
// page then misses everyone who joins later until it is reloaded. So every quiet socket
// gets a cheap REQ that relays answer with EOSE straight away; no answer means the
// connection is dead, and it is torn down so Trystero reconnects and resubscribes.
const PROBE_EVERY_MS = 10_000
const PROBE_TIMEOUT_MS = 5_000
const PROBE_PREFIX = 'gs-ping-'
const tracked = new WeakMap() // socket -> { lastSeen, probe: { id, at } | null }
let watching = false

function watchRelays() {
  if (watching) return
  watching = true
  setInterval(checkRelays, PROBE_EVERY_MS / 3)
  // Waking phones and laptops: refresh straight away rather than waiting for a probe.
  addEventListener('online', () => refreshAll('network back'))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshAll('page visible again')
  })
}

function track(socket) {
  let t = tracked.get(socket)
  if (t) return t
  t = { lastSeen: performance.now(), probe: null }
  tracked.set(socket, t)
  // Wrap Trystero's handler: note activity, and keep our probe replies away from it
  // (it would treat a CLOSED for an unknown subscription as the relay rejecting it).
  const original = socket.onmessage
  socket.onmessage = (e) => {
    t.lastSeen = performance.now()
    if (typeof e.data === 'string' && e.data.includes(PROBE_PREFIX)) {
      t.probe = null
      return
    }
    original?.call(socket, e)
  }
  return t
}

function checkRelays() {
  const now = performance.now()
  for (const socket of Object.values(getRelaySockets())) {
    if (socket.readyState !== WebSocket.OPEN) continue
    const t = track(socket)
    if (t.probe) {
      if (now - t.probe.at > PROBE_TIMEOUT_MS) restart(socket, 'no answer from relay')
      continue
    }
    if (now - t.lastSeen < PROBE_EVERY_MS) continue
    const id = PROBE_PREFIX + Math.random().toString(36).slice(2, 10)
    t.probe = { id, at: now }
    try {
      socket.send(JSON.stringify(['REQ', id, { kinds: [1], limit: 0 }]))
      socket.send(JSON.stringify(['CLOSE', id]))
    } catch {
      restart(socket, 'send failed')
    }
  }
}

function refreshAll(reason) {
  for (const socket of Object.values(getRelaySockets())) {
    const t = tracked.get(socket)
    // Only sockets that have been quiet a while; a live one answered recently.
    if (socket.readyState === WebSocket.OPEN && (!t || performance.now() - t.lastSeen > PROBE_EVERY_MS)) {
      track(socket).lastSeen = 0 // probe on the next check
    }
  }
  checkRelays()
  if (reason) console.debug(`gifshooter: checking relays (${reason})`)
}

// Hand the dead socket's close to Trystero now (it reconnects and resubscribes) instead
// of waiting for the browser's own close, which can take minutes on a half-open link.
function restart(socket, reason) {
  console.debug(`gifshooter: relay ${socket.url} looks dead (${reason}), reconnecting`)
  const onclose = socket.onclose
  socket.onclose = null
  socket.onmessage = null
  try {
    socket.close()
  } catch {}
  onclose?.call(socket, new CloseEvent('close'))
}
