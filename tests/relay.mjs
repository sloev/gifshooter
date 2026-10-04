// Minimal in-memory Nostr relay for local tests (no persistence, no signature checks).
//   node tests/relay.mjs [port]
import { WebSocketServer } from 'ws'

const port = Number(process.argv[2]) || 7777
const wss = new WebSocketServer({ port })
const subs = new Map() // socket -> Map(subId -> filters)
const matches = (ev, f) =>
  (!f.kinds || f.kinds.includes(ev.kind)) &&
  Object.entries(f).every(([k, v]) => !k.startsWith('#') || ev.tags.some((t) => t[0] === k.slice(1) && v.includes(t[1])))

wss.on('connection', (ws) => {
  subs.set(ws, new Map())
  ws.on('message', (raw) => {
    const [type, ...rest] = JSON.parse(raw)
    if (type === 'REQ') {
      const [id, ...filters] = rest
      subs.get(ws).set(id, filters)
      ws.send(JSON.stringify(['EOSE', id]))
    } else if (type === 'CLOSE') {
      subs.get(ws).delete(rest[0])
    } else if (type === 'EVENT') {
      const ev = rest[0]
      ws.send(JSON.stringify(['OK', ev.id, true, '']))
      for (const [client, m] of subs) for (const [id, fs] of m) if (fs.some((f) => matches(ev, f))) client.send(JSON.stringify(['EVENT', id, ev]))
    }
  })
  ws.on('close', () => subs.delete(ws))
})
console.log(`relay listening on ${port}`)
