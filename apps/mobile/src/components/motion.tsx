import { useEffect } from 'react'
import { Pressable, type GestureResponderEvent, type PressableProps, type StyleProp, type ViewStyle } from 'react-native'
import Animated, {
  Easing,
  FadeInDown,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'

/**
 * Motion helpers. Every animation here uses ReduceMotion.System, so when the phone's
 * "Reduce Motion" accessibility setting is on, values jump to their end state instead
 * of animating.
 */

const AnimatedPressable = Animated.createAnimatedComponent(Pressable)

/** A Pressable that shrinks slightly while held. Drop-in for Pressable (style must not be a function). */
export function PressableScale({
  style,
  onPressIn,
  onPressOut,
  scaleTo = 0.96,
  ...rest
}: Omit<PressableProps, 'style'> & { style?: StyleProp<ViewStyle>; scaleTo?: number }) {
  const scale = useSharedValue(1)
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))
  return (
    <AnimatedPressable
      {...rest}
      style={[style, animated]}
      onPressIn={(e: GestureResponderEvent) => {
        scale.value = withTiming(scaleTo, { duration: 90, reduceMotion: ReduceMotion.System })
        onPressIn?.(e)
      }}
      onPressOut={(e: GestureResponderEvent) => {
        scale.value = withSpring(1, { damping: 16, stiffness: 320, reduceMotion: ReduceMotion.System })
        onPressOut?.(e)
      }}
    />
  )
}

/** Staggered entrance for list items. Capped so a long list does not wait seconds. */
export function enterItem(index: number) {
  return FadeInDown.delay(Math.min(index, 8) * 60)
    .duration(260)
    .reduceMotion(ReduceMotion.System)
}

/** Progress bar fill that eases to its value, from empty on first appearance. */
export function AnimatedFill({ pct, color, height }: { pct: number; color: string; height: number }) {
  const w = useSharedValue(0)
  useEffect(() => {
    w.value = withTiming(pct, {
      duration: 650,
      easing: Easing.out(Easing.cubic),
      reduceMotion: ReduceMotion.System,
    })
  }, [pct, w])
  const animated = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }))
  return <Animated.View style={[{ height, borderRadius: height / 2, backgroundColor: color }, animated]} />
}
