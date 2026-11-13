// CORVAX only imports werift (WebRTC for Node) when the runtime has no RTCPeerConnection.
// Browsers always have one, so the browser build gets this empty stand-in instead of the
// Node library.
export const RTCPeerConnection = undefined
