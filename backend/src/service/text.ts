/** The length of a text as a person counts it: in characters, an emoji or accented letter as one. */
export function characters(text: string): number {
  let count = 0
  for (const _ of new Intl.Segmenter().segment(text)) count++
  return count
}
