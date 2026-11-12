const AVATAR_COLOURS = ['#EC4899', '#8B5CF6', '#0EA5E9', '#F97316', '#14B8A6', '#84CC16']

/** A colour of its own for each person's initials, the same every time, on every view. */
export function avatarColour(id: string): string {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return AVATAR_COLOURS[hash % AVATAR_COLOURS.length]!
}
