/**
 * Exercise energy — deterministic MET arithmetic, not a model guess.
 *
 * kcal = MET x 3.5 x kg / 200 x minutes (the standard ACSM formula). MET
 * values are from the Compendium of Physical Activities, matched to the same
 * three intensity anchors the incumbent shows the user. D16 applies to
 * exercise exactly as it does to food: Run and Weight lifting never touch a
 * model — only the free-text Describe path does, and it is labeled as such.
 */

export type ExerciseKind = 'run' | 'weights'
export type Intensity = 'low' | 'medium' | 'high'

export interface IntensityAnchor {
  level: Intensity
  title: string
  desc: string
  met: number
}

export const INTENSITY_ANCHORS: Record<ExerciseKind, readonly IntensityAnchor[]> = {
  run: [
    { level: 'high', title: 'Wysoka', desc: 'Sprint, 22,5 km/h (2:40 min/km)', met: 12.5 },
    { level: 'medium', title: 'Średnia', desc: 'Trucht, 9,7 km/h (6:13 min/km)', met: 9.8 },
    { level: 'low', title: 'Niska', desc: 'Spokojny spacer, 4,8 km/h (12:26 min/km)', met: 3.5 },
  ],
  weights: [
    { level: 'high', title: 'Wysoka', desc: 'Trening do upadku, ciężki oddech', met: 6.0 },
    { level: 'medium', title: 'Średnia', desc: 'Pocisz się, dużo powtórzeń', met: 4.5 },
    { level: 'low', title: 'Niska', desc: 'Bez potu, mały wysiłek', met: 3.0 },
  ],
}

export function metFor(kind: ExerciseKind, level: Intensity): number {
  return INTENSITY_ANCHORS[kind].find((a) => a.level === level)!.met
}

/** Standard formula; weight matters — 30 hard minutes differ ~40% between 60 and 100 kg. */
export function exerciseKcal(kind: ExerciseKind, level: Intensity, weightKg: number, minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0 || !Number.isFinite(weightKg) || weightKg <= 0) return 0
  return Math.round((metFor(kind, level) * 3.5 * weightKg * minutes) / 200)
}
