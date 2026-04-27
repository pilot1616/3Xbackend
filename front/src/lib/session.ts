import { useEffect, useState } from 'react';

import type { AuthResult, SessionData } from '../types/api';

const SESSION_KEY = 'front_session';
const SESSION_EVENT = 'front-session-change';

export function getSession(): SessionData | null {
  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as SessionData;
  } catch {
    window.localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function saveSession(result: AuthResult): void {
  const session: SessionData = {
    token: result.token,
    user: result.user,
    expiresAt: result.expires_at,
  };
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  window.dispatchEvent(new Event(SESSION_EVENT));
}

export function clearSession(): void {
  window.localStorage.removeItem(SESSION_KEY);
  window.dispatchEvent(new Event(SESSION_EVENT));
}

export function useSession() {
  const [session, setSession] = useState<SessionData | null>(() => getSession());

  useEffect(() => {
    const update = () => setSession(getSession());
    window.addEventListener(SESSION_EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(SESSION_EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, []);

  return session;
}
