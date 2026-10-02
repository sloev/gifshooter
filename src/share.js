// Share a canvas link through the system share sheet, or copy it where there is none.
const SHARE_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3M7 8l5-5 5 5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>'
export { SHARE_ICON }

export async function shareLink(url, code) {
  const data = { title: 'gifshooter', text: `Paint on the gifshooter canvas “${code}” with me!`, url }
  if (navigator.share && (!navigator.canShare || navigator.canShare(data))) {
    try {
      await navigator.share(data)
      return
    } catch (err) {
      if (err?.name === 'AbortError') return // the person closed the sheet
    }
  }
  try {
    await navigator.clipboard.writeText(url)
    toast('Link copied')
  } catch {
    toast(url)
  }
}

let toastTimer = 0
function toast(text) {
  let el = document.getElementById('toast')
  if (!el) {
    el = Object.assign(document.createElement('div'), { id: 'toast', role: 'status' })
    document.body.append(el)
  }
  el.textContent = text
  el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200)
}
