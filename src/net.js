// Serverless signalling: Trystero over public Nostr relays (its default relay set),
// then plain WebRTC data channels between peers.
import { joinRoom, selfId } from 'trystero/nostr'

const APP_ID = 'gifshooter-v2'

export { selfId }

// Is anyone (a screen or painters) in this room right now? Joins briefly and waits for
// a peer. Announces itself as a probe so screens don't count it as a painter.
export function probeRoom(code, ms = 5000) {
  const { room, hello } = connect(code)
  return new Promise((resolve) => {
    const done = (inUse) => {
      clearTimeout(timer)
      room.onPeerJoin = null
      resolve(inUse)
      room.leave().catch(() => {})
    }
    const timer = setTimeout(() => done(false), ms)
    room.onPeerJoin = (peerId) => {
      hello.send({ role: 'probe' }, { target: peerId }).catch(() => {})
      // give the probe hello a moment to go out before leaving
      setTimeout(() => done(true), 150)
    }
  })
}

export function connect(code) {
  // Optional override for testing / when the default relays are blocked:
  //   ?relays=wss://relay.one,wss://relay.two
  const relays = new URLSearchParams(location.search).get('relays')
  const config = { appId: APP_ID }
  if (relays) config.relayConfig = { urls: relays.split(',').filter(Boolean) }

  const room = joinRoom(config, `canvas:${code}`)
  return {
    room,
    // Screens announce themselves; painters announce nothing and just stream their cursor.
    hello: room.makeAction('hello'),
    cursor: room.makeAction('cursor'),
  }
}
