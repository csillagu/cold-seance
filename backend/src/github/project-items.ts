// An issue's items in GitHub Projects, with the option of the configured status field each is in
// (SRC-252, DD-015): what the GitHub change handler (SC-023) and the seeding importer (SC-025)
// read start and hold from.
import type { Repository } from './app-tokens.ts'
import type { GitHubClient } from './client.ts'
import { arrayField, objectField, stringField } from './json.ts'

/** An item of an issue in a GitHub Project, with the option of the status field it is in. */
export interface ProjectItem {
  projectId: string
  itemId: string
  /** The option's name; null if the item has none. */
  value: string | null
  /** The status field and its options, as GitHub gives them with a value. */
  field: { id: string; options: { id: string; name: string }[] } | undefined
}

const ITEMS_QUERY = `query ($owner: String!, $name: String!, $number: Int!, $field: String!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      projectItems(first: 50) {
        nodes {
          id
          project { id }
          fieldValueByName(name: $field) {
            ... on ProjectV2ItemFieldSingleSelectValue {
              name
              field { ... on ProjectV2SingleSelectField { id options { id name } } }
            }
          }
        }
      }
    }
  }
}`

/** The items of issue `number` of `repository` in GitHub Projects, each with its option of `field`. */
export async function readProjectItems(
  client: GitHubClient,
  repository: Repository,
  number: number,
  field: string,
): Promise<ProjectItem[]> {
  const answer = await client.graphql('projectsStatus', repository, ITEMS_QUERY, {
    owner: repository.owner,
    name: repository.name,
    number,
    field,
  })
  const issue = objectField(objectField(objectField(answer, 'repository'), 'issue'), 'projectItems')
  return arrayField(issue, 'nodes').flatMap((node): ProjectItem[] => {
    const itemId = stringField(node, 'id')
    const projectId = stringField(objectField(node, 'project'), 'id')
    if (itemId === undefined || projectId === undefined) return []
    const value = objectField(node, 'fieldValueByName')
    const valueField = objectField(value, 'field')
    const fieldId = stringField(valueField, 'id')
    return [
      {
        itemId,
        projectId,
        value: stringField(value, 'name') ?? null,
        field:
          fieldId === undefined
            ? undefined
            : {
                id: fieldId,
                options: arrayField(valueField, 'options').flatMap((o) => {
                  const id = stringField(o, 'id')
                  const name = stringField(o, 'name')
                  return id === undefined || name === undefined ? [] : [{ id, name }]
                }),
              },
      },
    ]
  })
}

/**
 * The status option the issue's Project items agree on: null for none (no item, or no item in an
 * option), `undefined` if they are in different ones.
 */
export function agreed(items: readonly ProjectItem[]): string | null | undefined {
  const values = new Set(items.map((item) => item.value))
  if (values.size === 0) return null
  if (values.size > 1) return undefined
  const [value] = values
  return value ?? null
}

/** Whether two option names are the same, ignoring case and the spaces around them. */
export function same(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}
