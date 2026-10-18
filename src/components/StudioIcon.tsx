interface Props { name: 'terminal' | 'palette' | 'font' | 'opacity' | 'background' | 'check' | 'arrow' | 'plus' | 'close'; size?: number }
export function StudioIcon({ name, size = 18 }: Props) {
  const paths = {
    terminal: <><path d="m5 7 4 5-4 5M12 17h7" /></>,
    palette: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16M15 4v16" /></>,
    font: <><path d="m3 19 6-14 6 14M5 15h8M16 10h5M18.5 10v9" /></>,
    opacity: <><circle cx="12" cy="12" r="8" /><path d="M12 4v16M12 7h5M12 10h7M12 13h7M12 16h5" /></>,
    background: <><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="8" cy="9" r="1" /><path d="m3 17 5-5 4 4 4-6 5 7" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    plus: <path d="M12 5v14M5 12h14" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}
