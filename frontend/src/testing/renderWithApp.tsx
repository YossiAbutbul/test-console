/**
 * Render a page or panel inside the providers main.tsx gives the app, so a
 * component test exercises the real contexts rather than hand-made stubs.
 * Pair with `installFakeBackend`: the providers poll the backend at mount.
 */
import type { ReactNode } from 'react'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeModeProvider } from '../context/ThemeModeContext'
import { CapabilitiesProvider } from '../context/CapabilitiesContext'
import { ConnectionProvider } from '../context/ConnectionContext'
import { LogProvider } from '../context/LogContext'
import { ChatProvider } from '../context/ChatContext'
import { InstrumentsProvider } from '../context/InstrumentsContext'
import { NicknamesProvider } from '../context/NicknamesContext'
import { PathLossProvider } from '../context/PathLossContext'
import { NotifyProvider } from '../context/NotifyContext'
import { LiveOutputProvider } from '../context/LiveOutputContext'

export function renderWithApp(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ThemeModeProvider>
        <LogProvider>
          <CapabilitiesProvider>
            <ConnectionProvider>
              <InstrumentsProvider>
                <NicknamesProvider>
                  <PathLossProvider>
                    <NotifyProvider>
                      <ChatProvider>
                        <LiveOutputProvider>{ui}</LiveOutputProvider>
                      </ChatProvider>
                    </NotifyProvider>
                  </PathLossProvider>
                </NicknamesProvider>
              </InstrumentsProvider>
            </ConnectionProvider>
          </CapabilitiesProvider>
        </LogProvider>
      </ThemeModeProvider>
    </QueryClientProvider>,
  )
}
