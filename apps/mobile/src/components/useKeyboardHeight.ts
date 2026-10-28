import { useEffect, useState } from 'react'
import { Keyboard, Platform } from 'react-native'

/**
 * Height of the on-screen keyboard, 0 when hidden. Used to lift bottom-pinned
 * buttons so the one you need is never hidden behind the keyboard.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0)
  useEffect(() => {
    const ios = Platform.OS === 'ios'
    const show = Keyboard.addListener(ios ? 'keyboardWillChangeFrame' : 'keyboardDidShow', (e) =>
      setHeight(e.endCoordinates.height),
    )
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setHeight(0))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])
  return height
}
