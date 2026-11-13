/**
 * A task's eligibility expression as the REST API gives and takes it (FR-028, DD-038): a person, by
 * account id, or an AND (`all`) or OR (`any`) of people and, one level down, of ANDs and ORs of
 * people. It is at most two levels deep.
 */
export type Eligibility = string | { all: Operand[] } | { any: Operand[] }

/** An operand of the top level: a person, or an AND or OR of people. */
export type Operand = string | { all: string[] } | { any: string[] }

/** AND (`all`) or OR (`any`). */
export type Operator = 'all' | 'any'

/** A group of the second level: an AND or OR of people, which holds no group of its own. */
export interface Group {
  operator: Operator
  people: string[]
}

/**
 * An eligibility expression as the editor builds it (SC-099): a top level whose items are people
 * and groups of people. A group cannot hold a group, so an expression deeper than two levels cannot
 * be built (FR-197). No items is no expression.
 */
export interface EligibilityDraft {
  operator: Operator
  items: (string | Group)[]
}

const operatorOf = (node: { all: unknown[] } | { any: unknown[] }): Operator =>
  'all' in node ? 'all' : 'any'

const operandsOf = <T>(node: { all: T[] } | { any: T[] }): T[] =>
  'all' in node ? node.all : node.any

/**
 * The draft of `expression`, as stored. A lone person is shown as the one item of an OR; it is
 * saved as it was unless the draft is changed.
 */
export function draftOf(expression: Eligibility | null): EligibilityDraft {
  if (expression === null) return { operator: 'any', items: [] }
  if (typeof expression === 'string') return { operator: 'any', items: [expression] }
  return {
    operator: operatorOf(expression),
    items: operandsOf<Operand>(expression).map((operand) =>
      typeof operand === 'string'
        ? operand
        : { operator: operatorOf(operand), people: [...operandsOf(operand)] },
    ),
  }
}

/**
 * The expression the draft builds, as the REST API takes it, exactly as built: nothing is
 * flattened or regrouped (TC-038). `null` for a draft with no items.
 */
export function expressionOf(draft: EligibilityDraft): Eligibility | null {
  if (draft.items.length === 0) return null
  const operands: Operand[] = draft.items.map((item) =>
    typeof item === 'string' ? item : group(item.operator, item.people),
  )
  return draft.operator === 'all' ? { all: operands } : { any: operands }
}

function group(operator: Operator, people: string[]): Operand {
  return operator === 'all' ? { all: [...people] } : { any: [...people] }
}

/** Why the draft cannot be saved yet, or `null` if it can: an empty group has no meaning. */
export function draftProblem(draft: EligibilityDraft): string | null {
  return draft.items.some((item) => typeof item !== 'string' && item.people.length === 0)
    ? 'Each group needs at least one person.'
    : null
}

/** Whether two expressions are the same, operand for operand. */
export function sameExpression(a: Eligibility | null, b: Eligibility | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

const WORD: Record<Operator, string> = { all: 'AND', any: 'OR' }

/**
 * The expression in words, such as `alice AND (bob OR carol)`, each person by `nameOf`. A group of
 * one person is shown without brackets. "No one" for no expression.
 */
export function describeExpression(
  expression: Eligibility | null,
  nameOf: (accountId: string) => string,
): string {
  if (expression === null) return 'No one'
  if (typeof expression === 'string') return nameOf(expression)
  const word = ` ${WORD[operatorOf(expression)]} `
  return operandsOf<Operand>(expression)
    .map((operand) => {
      if (typeof operand === 'string') return nameOf(operand)
      const people = operandsOf(operand).map(nameOf)
      return people.length === 1 ? people[0] : `(${people.join(` ${WORD[operatorOf(operand)]} `)})`
    })
    .join(word)
}
