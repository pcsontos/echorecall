import { describe, it, expect } from 'vitest'
import en from '../../i18n/locales/en.json'
import hu from '../../i18n/locales/hu.json'

// FR-019 / SC-009: every user-visible string MUST exist in both supported
// locales (English + Hungarian, the Hungarian-default app). This guard fails the
// moment a key is added to one locale but not the other, so a missing translation
// is caught here instead of shipping a blank label. It also asserts the namespaces
// introduced by the 005 dashboard redesign are scaffolded in both locales (their
// individual keys are filled in per user story).

type Tree = { [key: string]: string | Tree }

/** Every dotted key path in a locale tree (intermediate + leaf nodes), sorted. */
function keyPaths(tree: Tree, prefix = ''): string[] {
  const paths: string[] = []
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    paths.push(path)
    if (value && typeof value === 'object') paths.push(...keyPaths(value, path))
  }
  return paths.sort()
}

/** True when `path` (dotted) resolves to a defined node in `tree`. */
function hasPath(tree: Tree, path: string): boolean {
  let node: string | Tree | undefined = tree
  for (const key of path.split('.')) {
    if (node && typeof node === 'object' && key in node) node = node[key]
    else return false
  }
  return node !== undefined
}

/** Namespaces newly introduced by feature 005 (keys filled in per user story). */
const NEW_NAMESPACES = [
  'generate.toolbar',
  'generate.columns',
  'library.tags',
  'library.waveform',
  'settings.modal',
  'generateNext.settings.catalogError',
  'settings.openaiKey.testCodes',
] as const

const enTree = en as unknown as Tree
const huTree = hu as unknown as Tree

describe('i18n locale parity (en ⇄ hu)', () => {
  it('en and hu have identical key structure', () => {
    expect(keyPaths(enTree)).toEqual(keyPaths(huTree))
  })

  it('scaffolds every feature-005 namespace in both locales', () => {
    for (const ns of NEW_NAMESPACES) {
      expect(hasPath(enTree, ns), `en missing namespace: ${ns}`).toBe(true)
      expect(hasPath(huTree, ns), `hu missing namespace: ${ns}`).toBe(true)
    }
  })
})
