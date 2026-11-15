import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { I } from './ui.jsx'

/* A PDF opened inside RoarMe, as Telegram's (Alex, 15 Nov): full screen, the file's name on top, "1 of N" as you
   scroll, every page drawn sharp, and at the foot Save (to the phone's Files, or a download on a computer) and Share.
   The pages are drawn by pdf.js, fetched from jsDelivr only when a PDF is opened (it is large and most people never need
   it); if it cannot load, Save and Share still work. */
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/'
let lib = null
async function pdfjs() {
  if (lib) return lib
  lib = (async () => {
    const m = await import(/* @vite-ignore */ `${PDFJS}pdf.min.mjs`)
    // a worker must come from our own origin: wrap the CDN's worker in a module of our own
    const src = await (await fetch(`${PDFJS}pdf.worker.min.mjs`)).text()
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))
    m.GlobalWorkerOptions.workerPort = new Worker(url, { type: 'module' })
    return m
  })()
  try { return await lib } catch (e) { lib = null; throw e }
}

const SAVE_I = <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" /></svg>
const SHARE_I = <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 15V3.5M8 7.5l4-4 4 4M7 11H5.5A1.5 1.5 0 0 0 4 12.5v6A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-6a1.5 1.5 0 0 0-1.5-1.5H17" /></svg>

function Page({ doc, n, width }) {
  const ref = useRef(null)
  const [seen, setSeen] = useState(n <= 2)
  const [ratio, setRatio] = useState(1.414)
  useEffect(() => {
    const el = ref.current
    if (seen || !el || typeof IntersectionObserver === 'undefined') return undefined
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) setSeen(true) }, { rootMargin: '800px' })
    io.observe(el)
    return () => io.disconnect()
  }, [seen])
  useEffect(() => {
    if (!seen || !width) return undefined
    let alive = true
    let task = null
    doc.getPage(n).then((page) => {
      if (!alive) return
      const base = page.getViewport({ scale: 1 })
      setRatio(base.height / base.width)
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
      const vp = page.getViewport({ scale: (width / base.width) * dpr })
      const c = ref.current?.querySelector('canvas')
      if (!c) return
      c.width = Math.round(vp.width); c.height = Math.round(vp.height)
      task = page.render({ canvasContext: c.getContext('2d'), viewport: vp })
      task.promise.catch(() => {})
    })
    return () => { alive = false; task?.cancel?.() }
  }, [seen, width, doc, n])
  return <div ref={ref} className="pdfv-page" data-page={n} style={{ height: width ? width * ratio : undefined }}><canvas /></div>
}

export function PdfView({ url, name, onClose }) {
  const [doc, setDoc] = useState(null)
  const [err, setErr] = useState('')
  const [at, setAt] = useState(1)
  const [width, setWidth] = useState(0)
  const box = useRef(null)
  useEffect(() => {
    let alive = true
    let d = null
    pdfjs().then((m) => m.getDocument({ url }).promise).then((x) => { d = x; if (alive) setDoc(x) }).catch(() => { if (alive) setErr('This PDF cannot be shown here. Save it or share it to open it.') })
    return () => { alive = false; d?.destroy?.() }
  }, [url])
  useEffect(() => {
    const el = box.current
    if (!el) return undefined
    const fit = () => setWidth(Math.min(el.clientWidth - 24, 900))
    fit()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [])
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') onClose() }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [onClose])
  const onScroll = (e) => {
    const el = e.currentTarget
    const mid = el.scrollTop + el.clientHeight / 3
    let cur = 1
    el.querySelectorAll('.pdfv-page').forEach((p) => { if (p.offsetTop <= mid) cur = Number(p.dataset.page) })
    setAt(cur)
  }
  const file = async () => {
    const blob = await (await fetch(url)).blob()
    return new File([blob], name || 'file.pdf', { type: 'application/pdf' })
  }
  const share = async () => {
    try { const f = await file(); if (navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f] }); else save() } catch { /* closed */ }
  }
  // Save: on a phone the share sheet is the way into Files ("Save to Files"); on a computer a download with its name
  const save = async () => {
    try {
      const f = await file()
      if (navigator.canShare?.({ files: [f] }) && window.matchMedia?.('(pointer: coarse)').matches) { await navigator.share({ files: [f] }); return }
      const u = URL.createObjectURL(f)
      const a = document.createElement('a'); a.href = u; a.download = f.name; document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(u), 4000)
    } catch { /* closed */ }
  }
  return createPortal(
    <div className="pdfv" role="dialog" aria-label={name || 'PDF'}>
      <div className="pdfv-head">
        <button type="button" className="round" onClick={onClose} aria-label="Close">{I.x}</button>
        <b className="pdfv-name">{name || 'file.pdf'}</b>
        <span className="pdfv-pad" />
      </div>
      <div className="pdfv-body" ref={box} onScroll={onScroll}>
        {doc && <span className="pdfv-count">{at} of {doc.numPages}</span>}
        {!doc && !err && <p className="pdfv-wait">Opening…</p>}
        {err && <p className="pdfv-wait">{err}</p>}
        {doc && Array.from({ length: doc.numPages }, (_, k) => <Page key={k} doc={doc} n={k + 1} width={width} />)}
      </div>
      <div className="pdfv-foot">
        <button type="button" onClick={save} aria-label="Save"><i>{SAVE_I}</i><span>Save</span></button>
        <button type="button" onClick={share} aria-label="Share"><i>{SHARE_I}</i><span>Share</span></button>
      </div>
    </div>,
    document.body,
  )
}
