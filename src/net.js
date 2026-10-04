// Serverless signalling: Trystero over public Nostr relays (its default relay set),
// then plain WebRTC data channels between peers.
import { joinRoom, selfId } from 'trystero/nostr'

const APP_ID = 'gifshooter-v2'

export { selfId }

// Without WebRTC (some embedded browsers, WebKitGTK with it switched off) there is no
// way to connect; hand back an inert room so the page still renders and can say why.
const offlineRoom = () => {
  const action = () => ({ send: async () => {}, onMessage: null })
  return { offline: true, room: { onPeerJoin: null, onPeerLeave: null, leave: async () => {} }, hello: action(), cursor: action() }
}

export function connect(code) {
  if (typeof RTCPeerConnection === 'undefined') return offlineRoom()

  // Optional override for testing / when the default relays are blocked:
  //   ?relays=wss://relay.one,wss://relay.two
  const relays = new URLSearchParams(location.search).get('relays')
  const config = { appId: APP_ID }
  if (relays) config.relayConfig = { urls: relays.split(',').filter(Boolean) }

  const room = joinRoom(config, `canvas:${code}`)
  return {
    offline: false,
    room,
    // Screens announce themselves; painters announce nothing and just stream their cursor.
    hello: room.makeAction('hello'),
    cursor: room.makeAction('cursor'),
  }
}
