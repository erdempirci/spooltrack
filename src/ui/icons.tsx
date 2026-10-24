import type { IsoStatus } from '../domain/types';
import { STATUS_LABEL } from '../domain/types';

const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };

export function StatusIcon({ status }: { status: IsoStatus }) {
  switch (status) {
    case 'baslamadi':
      return <svg {...base}><circle cx="12" cy="12" r="8" /></svg>;
    case 'devam':
      return (
        <svg {...base}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" />
        </svg>
      );
    case 'bitti':
      return (
        <svg {...base}>
          <circle cx="12" cy="12" r="8" />
          <path d="M8.5 12.5l2.5 2.5 4.5-5" />
        </svg>
      );
    default:
      return <svg {...base}><circle cx="12" cy="12" r="8" strokeDasharray="3 3" /></svg>;
  }
}

/** Status is always shown with icon + text, never colour alone. */
export function StatusBadge({ status }: { status: IsoStatus }) {
  return (
    <span className={`badge st-${status}`}>
      <StatusIcon status={status} />
      {STATUS_LABEL[status]}
    </span>
  );
}

export const Icon = {
  logo: () => (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#1d5fd1" />
      <path d="M8 11h11.5a1.5 1.5 0 0 1 1.5 1.5V24" stroke="#fff" strokeWidth="3" fill="none" />
      <path d="M8 7.5v7M17.5 24h7" stroke="#fff" strokeWidth="2.5" />
    </svg>
  ),
  production: () => <svg {...base}><path d="M4 7h10a4 4 0 0 1 4 4v9" /><path d="M4 4v6M15 20h6" /></svg>,
  material: () => <svg {...base}><path d="M3 7l9-4 9 4-9 4-9-4z" /><path d="M3 12l9 4 9-4M3 17l9 4 9-4" /></svg>,
  report: () => <svg {...base}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>,
  upload: () => <svg {...base}><path d="M12 16V4M7 9l5-5 5 5M4 20h16" /></svg>,
  account: () => <svg {...base}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>,
  download: () => <svg {...base}><path d="M12 4v12M7 11l5 5 5-5M4 20h16" /></svg>,
  file: () => <svg {...base}><path d="M14 3H6v18h12V7z" /><path d="M14 3v4h4" /></svg>,
};
