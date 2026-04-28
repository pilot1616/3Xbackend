import type { CSSProperties, SVGProps } from 'react';

type LegacyIconName =
  | 'search'
  | 'eye'
  | 'eye-invisible'
  | 'home'
  | 'cellphone'
  | 'email'
  | 'friends'
  | 'weibo'
  | 'survey'
  | 'wechat'
  | 'qq'
  | 'date'
  | 'praise'
  | 'reply-fill'
  | 'right'
  | 'down'
  | 'up';

interface LegacyIconProps {
  name: LegacyIconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
}

function Outline({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" fill="none" focusable="false" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" viewBox="0 0 24 24" {...props}>
      {children}
    </svg>
  );
}

export function LegacyIcon({ name, size = 16, className, style }: LegacyIconProps) {
  const props = {
    className: className ? `legacy-icon ${className}` : 'legacy-icon',
    style: { width: size, height: size, ...style },
  };

  switch (name) {
    case 'search':
      return (
        <Outline {...props}>
          <circle cx="11" cy="11" r="6"></circle>
          <path d="m20 20-4.2-4.2"></path>
        </Outline>
      );
    case 'eye':
      return (
        <Outline {...props}>
          <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"></path>
          <circle cx="12" cy="12" r="2.5"></circle>
        </Outline>
      );
    case 'eye-invisible':
      return (
        <Outline {...props}>
          <path d="M3 3l18 18"></path>
          <path d="M10.6 6.3A11.8 11.8 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.4 3.8"></path>
          <path d="M6.7 6.8C4.1 8.4 2 12 2 12s3.5 6 10 6c1.4 0 2.7-.3 3.9-.8"></path>
          <path d="M9.9 9.9A3 3 0 0 0 12 15a3 3 0 0 0 2.1-.9"></path>
        </Outline>
      );
    case 'home':
      return (
        <Outline {...props}>
          <path d="M3 10.5 12 3l9 7.5"></path>
          <path d="M5.5 9.5V20h13V9.5"></path>
          <path d="M10 20v-5h4v5"></path>
        </Outline>
      );
    case 'cellphone':
      return (
        <Outline {...props}>
          <rect x="7" y="2.5" width="10" height="19" rx="2"></rect>
          <path d="M11 18h2"></path>
        </Outline>
      );
    case 'email':
      return (
        <Outline {...props}>
          <rect x="3" y="5" width="18" height="14" rx="2"></rect>
          <path d="m4 7 8 6 8-6"></path>
        </Outline>
      );
    case 'friends':
      return (
        <Outline {...props}>
          <path d="M16 21v-1.5a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4V21"></path>
          <circle cx="10" cy="8" r="3"></circle>
          <path d="M20 21v-1a3.5 3.5 0 0 0-3-3.5"></path>
          <path d="M15.5 5.2A3 3 0 0 1 17 11"></path>
        </Outline>
      );
    case 'weibo':
      return (
        <Outline {...props}>
          <path d="M9.5 18c-3 0-5.5-1.8-5.5-4s2.5-4 5.5-4 5.5 1.8 5.5 4-2.5 4-5.5 4Z"></path>
          <path d="M16 7.5A4.5 4.5 0 0 1 19.5 11"></path>
          <path d="M15 4a7.5 7.5 0 0 1 6 6"></path>
          <circle cx="8.5" cy="13.5" r="1"></circle>
          <circle cx="11.5" cy="14.5" r="1"></circle>
        </Outline>
      );
    case 'survey':
      return (
        <Outline {...props}>
          <path d="M4 19h16"></path>
          <path d="M7 16V9"></path>
          <path d="M12 16V5"></path>
          <path d="M17 16v-7"></path>
        </Outline>
      );
    case 'wechat':
      return (
        <Outline {...props}>
          <path d="M9.5 5C5.9 5 3 7.4 3 10.5c0 1.7.9 3.2 2.3 4.2L5 19l3.1-1.7c.5.1.9.2 1.4.2 3.6 0 6.5-2.4 6.5-5.5S13.1 5 9.5 5Z"></path>
          <path d="M15.5 10.5c3.1 0 5.5 2 5.5 4.5 0 1.4-.7 2.6-1.9 3.4l.4 2.6-2.3-1.3c-.5.1-1.1.2-1.7.2-3.1 0-5.5-2-5.5-4.5s2.4-4.9 5.5-4.9Z"></path>
          <circle cx="7.8" cy="10.3" r="0.8" fill="currentColor" stroke="none"></circle>
          <circle cx="11.2" cy="10.3" r="0.8" fill="currentColor" stroke="none"></circle>
        </Outline>
      );
    case 'qq':
      return (
        <Outline {...props}>
          <path d="M12 4c2 0 3.5 1.8 3.5 4.7 0 .7-.1 1.5-.3 2.2.9.6 1.5 1.5 1.5 2.6 0 1.2-.8 2.2-1.9 2.8L16 20h-2l-1.1-2h-1.8L10 20H8l1.2-3.7A3.3 3.3 0 0 1 7.3 13.5c0-1.1.6-2 1.5-2.6-.2-.7-.3-1.5-.3-2.2C8.5 5.8 10 4 12 4Z"></path>
        </Outline>
      );
    case 'date':
      return (
        <Outline {...props}>
          <rect x="3" y="5" width="18" height="16" rx="2"></rect>
          <path d="M8 3v4"></path>
          <path d="M16 3v4"></path>
          <path d="M3 10h18"></path>
        </Outline>
      );
    case 'praise':
      return (
        <svg aria-hidden="true" className={props.className} fill="currentColor" focusable="false" style={props.style} viewBox="0 0 24 24">
          <path d="M10.7 3.6c.6.5.9 1.3.9 2.1v3.1h5.2c1.8 0 3 1.7 2.3 3.4l-2.3 6a2.5 2.5 0 0 1-2.3 1.6H6.7A2.7 2.7 0 0 1 4 17.1v-4.7c0-.7.3-1.4.8-1.9l4-4.6c.5-.6 1.1-1.3 1.9-2.3Z"></path>
          <path d="M4 10.7H2.5A1.5 1.5 0 0 0 1 12.2v5.6a1.5 1.5 0 0 0 1.5 1.5H4v-8.6Z"></path>
        </svg>
      );
    case 'reply-fill':
      return (
        <svg aria-hidden="true" className={props.className} fill="currentColor" focusable="false" style={props.style} viewBox="0 0 24 24">
          <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8A2.5 2.5 0 0 1 17.5 16H10l-4.8 4.3c-.7.6-1.8.1-1.8-.8V5.5Z"></path>
        </svg>
      );
    case 'right':
      return (
        <Outline {...props}>
          <path d="m9 6 6 6-6 6"></path>
        </Outline>
      );
    case 'down':
      return (
        <Outline {...props}>
          <path d="m6 9 6 6 6-6"></path>
        </Outline>
      );
    case 'up':
      return (
        <Outline {...props}>
          <path d="m6 15 6-6 6 6"></path>
        </Outline>
      );
  }
}
