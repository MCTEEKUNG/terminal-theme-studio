import { useEffect, useState } from 'react'

interface NativeStatus {
  state: 'running' | 'starting' | 'stopped'
  mediaPath?: string | null
  error?: string | null
  tabCount?: number
  appearanceLive?: boolean
  performanceLive?: boolean
}

export function NativeTerminalLauncher() {
  const [status, setStatus] = useState<NativeStatus>({ state: 'stopped' })
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function refresh() {
      try {
        const response = await fetch('/api/native/status')
        if (!response.ok) throw new Error('Cannot read Studio Terminal status')
        const next: NativeStatus = await response.json()
        if (!cancelled) { setStatus(next); setError('') }
      } catch (failure) {
        if (!cancelled) setError((failure as Error).message)
      }
    }
    void refresh()
    const timer = setInterval(refresh, 2000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [])

  async function open() {
    setOpening(true)
    setError('')
    try {
      const response = await fetch('/api/native/open', { method: 'POST', headers: { 'X-Theme-Studio': 'native-terminal' } })
      const next = await response.json()
      if (!response.ok) throw new Error(next.error ?? 'Could not open Studio Terminal')
      setStatus(next)
    } catch (failure) { setError((failure as Error).message) }
    finally { setOpening(false) }
  }

  const running = status.state === 'running'
  return (
    <div className="terminal-connection">
      <strong>Studio Terminal · {running ? `Running${status.tabCount ? ` · ${status.tabCount} tabs` : ''}` : status.state === 'starting' ? 'Starting…' : 'Ready to open'}</strong>
      <p>Take this look into your shell, with your video or playlist behind the text.</p>
      <button className="btn-secondary native-terminal-open" onClick={open}
        disabled={opening || status.state === 'starting'}>
        {opening || status.state === 'starting' ? 'Opening…' : running ? 'Show Studio Terminal' : 'Open Studio Terminal'}
      </button>
      {running && <p role="status">{status.appearanceLive
        ? 'Live appearance connected · changes apply without restarting.'
        : 'One-time upgrade: close all Terminal windows and reopen to enable live tab styling.'}</p>}
      {running && status.appearanceLive && !status.performanceLive && <p>Reopen Terminal once to load the lower-load video player. Your running jobs have been left in place.</p>}
      {running && status.mediaPath && <p>Background: {status.mediaPath.split(/[\\/]/).pop()}</p>}
      {(error || status.error) && <p className="convert-error" role="alert">{error || status.error}</p>}
    </div>
  )
}
