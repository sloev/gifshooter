// Serverless signalling: Trystero over public Nostr relays (its default relay set),
// then plain WebRTC data channels between peers.
import { joinRoom, selfId } from 'trystero/nostr'

const APP_ID = 'gifshooter-v2'

export { selfId }

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
