import type { SVGProps } from 'react'

const base = (p: SVGProps<SVGSVGElement>) => ({
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...p
})

export const IconRefresh = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M13.5 8a5.5 5.5 0 1 1-1.61-3.89" />
    <path d="M13.5 2.5v3h-3" />
  </svg>
)

export const IconGear = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.5v1.6M8 12.9v1.6M14.5 8h-1.6M3.1 8H1.5M12.6 3.4l-1.13 1.13M4.53 11.47 3.4 12.6M12.6 12.6l-1.13-1.13M4.53 4.53 3.4 3.4" />
  </svg>
)

export const IconMin = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ width: 12, height: 12, viewBox: '0 0 12 12', strokeWidth: 1, ...p })}>
    <path d="M1.5 6h9" />
  </svg>
)

export const IconMax = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ width: 12, height: 12, viewBox: '0 0 12 12', strokeWidth: 1, ...p })}>
    <rect x="1.5" y="1.5" width="9" height="9" rx="0.5" />
  </svg>
)

export const IconRestore = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ width: 12, height: 12, viewBox: '0 0 12 12', strokeWidth: 1, ...p })}>
    <rect x="1.5" y="3.5" width="7" height="7" rx="0.5" />
    <path d="M3.5 3.5v-2h7v7h-2" />
  </svg>
)

export const IconClose = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ width: 12, height: 12, viewBox: '0 0 12 12', strokeWidth: 1, ...p })}>
    <path d="M2 2l8 8M10 2l-8 8" />
  </svg>
)

export const IconBack = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M10 3 5 8l5 5" />
  </svg>
)

export const IconChevron = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="m6 4 4 4-4 4" />
  </svg>
)

export const IconAlert = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M8 2.2 14.3 13H1.7z" />
    <path d="M8 6.5v3M8 11.3v.1" />
  </svg>
)

export const IconFolder = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M1.8 4.2c0-.7.5-1.2 1.2-1.2h3l1.4 1.6H13c.7 0 1.2.5 1.2 1.2v6c0 .7-.5 1.2-1.2 1.2H3c-.7 0-1.2-.5-1.2-1.2z" />
  </svg>
)

export const IconImage = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
    <circle cx="6" cy="6.3" r="1.2" />
    <path d="m2.5 12 3.8-3.6 2.6 2.4 2-1.8 2.6 2.4" />
  </svg>
)

export const IconWidget = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="1.8" y="4" width="12.4" height="8" rx="2" />
    <path d="M4.5 7h4M4.5 9.2h6.5" />
  </svg>
)
