'use client';

import { createContext, useContext, ReactNode } from 'react';

const SessionContext = createContext({});

export function SessionProvider({ children }: { children: ReactNode }) {
  return (
    <SessionContext.Provider value={{}}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}

