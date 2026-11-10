import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useColorScheme } from 'react-native'
import { darkTheme, lightTheme, type Theme } from './tokens'

const ThemeContext = createContext<Theme>(lightTheme)

export const useTheme = () => useContext(ThemeContext)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme()
  const theme = useMemo(() => (scheme === 'dark' ? darkTheme : lightTheme), [scheme])
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
}
