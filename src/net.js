// Serverless signalling with CORVAX (https://github.com/sloev/CORVAX): every tab is a peer
// with its own key. Screens publish presence on a topic named after the canvas code and
// accept WebRTC DataChannels; painters watch that topic and connect to each screen they
// see. Signalling runs over HTTPS through CORVAX anchors, then the data goes peer-to-peer
// (relayed only when a direct path can't be made).
import { Peer } from '@sloev/corvax/min' // the browser bundle (the package root resolves to Node sources)

const TOPIC = (code) => `gifshooter:canvas:${code}`
const LEASE_MS = 120e3 // screen presence lease; CORVAX renews it at half-time
const RETRY_MS = 6e3 // painters: how often to look again while no screen is connected

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

// One key per tab and role, so a reload stays the same peer.
function seedFor(key) {
  try {
    return sessionStorage.getItem(key) || undefined
  } catch {
    return undefined
  }
}
function keepSeed(key, seed) {
  try {
    sessionStorage.setItem(key, seed)
  } catch {}
}

// Optional extra anchors for testing (an anchor line or an http(s) URL):
//   ?anchors=<line-or-url>,<…>
function anchorOptions() {
  const given = new URLSearchParams(location.search).get('anchors')
  if (!given) return {}
  const list = given.split(',').filter(Boolean)
  const lines = list.filter((x) => x.startsWith('corvax-anchor:'))
  const sources = list.filter((x) => /^https?:/.test(x))
  return { anchors: lines, sources, allowPrivate: true, fallback: [] }
}

// The app talks to `room`, `hello` and `cursor` the way it always has: peers join and
// leave, and small JSON messages go to everyone or to `{ target }` peers. Underneath,
// each peer is one CORVAX DataChannel between a painter and a screen.
export function connect(code, role) {
  if (typeof RTCPeerConnection === 'undefined') return offlineRoom()

  const handlers = { onPeerJoin: null, onPeerLeave: null }
  const onMessage = { hello: null, cursor: null }
  const channels = new Map() // address -> RTCDataChannel
  const connecting = new Set()
  let peer = null
  let topic = null
  let closed = false
  let lookAgain = () => {}

  const attach = (address, channel) => {
    const old = channels.get(address)
    if (old && old !== channel) {
      try {
        old.close()
      } catch {}
    }
    channels.set(address, channel)
    channel.onmessage = (e) => {
      if (typeof e.data !== 'string') return
      let m
      try {
        m = JSON.parse(e.data)
      } catch {
        return
      }
      if (m && (m.a === 'hello' || m.a === 'cursor')) onMessage[m.a]?.(m.d, { peerId: address })
    }
    channel.onclose = () => {
      if (channels.get(address) !== channel) return
      channels.delete(address)
      handlers.onPeerLeave?.(address)
      lookAgain()
    }
    handlers.onPeerJoin?.(address)
  }

  const send = (name, data, opts = {}) => {
    const wire = JSON.stringify({ a: name, d: data })
    const targets = opts.target == null ? [...channels.keys()] : [].concat(opts.target)
    for (const address of targets) {
      const ch = channels.get(address)
      if (ch?.readyState === 'open') {
        try {
          ch.send(wire)
        } catch {}
      }
    }
    return Promise.resolve()
  }

  const start = async () => {
    const seedKey = `gifshooter:corvax-seed:${role}`
    peer = await Peer.create({ seed: seedFor(seedKey), storage: false, relayFor: false, ...anchorOptions() })
    keepSeed(seedKey, peer.seed)
    if (closed) return peer.close()
    topic = await peer.topic(TOPIC(code))

    if (role === 'screen') {
      // Painters find the screen by its presence on the topic, then connect to it.
      peer.accept(({ from, channel }) => attach(from, channel))
      const publish = () => topic.publish({ lease: LEASE_MS }).catch((e) => console.warn('gifshooter: publish failed', e))
      await publish()
      lookAgain = () => {}
      // If presence couldn't be stored (no anchor answered), keep trying.
      setInterval(() => {
        if (!closed && !topic.published) publish()
      }, 15e3)
      return
    }

    // Painter: our Beacon must exist so a screen can answer our offer.
    await peer.publish().catch((e) => console.warn('gifshooter: beacon failed', e))
    const reach = async (address) => {
      if (closed || channels.has(address) || connecting.has(address) || address === peer.address) return
      connecting.add(address)
      try {
        const { channel } = await peer.connect(address, { timeout: 12000 })
        if (closed) return channel.close()
        attach(address, channel)
      } catch (e) {
        console.debug('gifshooter: could not reach screen', address.slice(0, 8), e?.code || e?.message)
      } finally {
        connecting.delete(address)
      }
    }
    topic.subscribe({ presence: (e) => e.presence === 'recent' && reach(e.address) })
    let searching = false
    lookAgain = async () => {
      if (closed || searching) return
      searching = true
      try {
        for (const { address } of await topic.search()) reach(address)
      } catch {}
      searching = false
    }
    lookAgain()
    setInterval(() => {
      if (!channels.size) lookAgain()
    }, RETRY_MS)
  }
  const ready = start().catch((e) => console.error('gifshooter: could not start CORVAX', e))

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
    // Look for screens again (painters) — kept for callers that "knock" while alone.
    rejoin: () => ready.then(() => lookAgain()),
    leave: async () => {
      closed = true
      await ready
      for (const ch of channels.values()) {
        try {
          ch.close()
        } catch {}
      }
      await peer?.close().catch(() => {})
    },
  }
  const action = (name) => ({
    send: (data, opts) => send(name, data, opts),
    get onMessage() {
      return onMessage[name]
    },
    set onMessage(fn) {
      onMessage[name] = fn
    },
  })

  return { offline: false, room, hello: action('hello'), cursor: action('cursor') }
}
