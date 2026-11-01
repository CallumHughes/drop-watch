import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import {
	checkPrimitivesMapPaths,
	classifyPaths,
	defaultMapPath,
	loadPrimitivesMap,
	parsePrimitivesMap,
	pathMatchesRoot,
} from './primitives-map.mjs'

test('loads the repository map without an explicit path', () => {
	assert.equal(defaultMapPath, resolve(import.meta.dirname, '../../../../docs/architecture/primitives.yaml'))
	const map = loadPrimitivesMap()
	assert.ok(map.groups.some((group) => group.id === 'domain'))
	assert.ok(map.primitives.some((primitive) => primitive.id === 'extractor'))
	assert.ok(map.invariants.some((invariant) => invariant.id === 'per-user-isolation'))
	assert.deepEqual(checkPrimitivesMapPaths(map), [])
})

test('reads folded summaries, invariant statements, and exclusions in the current schema', () => {
	const map = parsePrimitivesMap(`groups:
  domain: Pure logic.
primitives:
  - id: extractor
    group: domain
    summary: >
      Extracts prices
      from product pages.
    code:
      - "packages/core/src/extract/**"
    excludes:
      - packages/core/src/extract/private/**
    depends_on:
      - money
invariants:
  - id: isolation
    statement: >
      Keep each user's
      data private.
    guarded_by: [extractor]
`)
	assert.deepEqual(map.groups, [{ id: 'domain', name: 'Pure logic.' }])
	assert.equal(map.primitives[0].name, 'extractor')
	assert.equal(map.primitives[0].summary, 'Extracts prices from product pages.')
	assert.deepEqual(map.primitives[0].code, ['packages/core/src/extract/**'])
	assert.deepEqual(map.primitives[0].excludes, ['packages/core/src/extract/private/**'])
	assert.equal(map.invariants[0].summary, "Keep each user's data private.")
})

test('matches recursive and filename globs without matching sibling prefixes', () => {
	assert.equal(pathMatchesRoot('packages/api/src/router.ts', 'packages/api/**'), true)
	assert.equal(pathMatchesRoot('packages/api-old/src/router.ts', 'packages/api/**'), false)
	assert.equal(pathMatchesRoot('apps/web/Dockerfile', '**/Dockerfile'), true)
	assert.equal(pathMatchesRoot('docker-compose.prod.yml', 'docker-compose*.yml'), true)
	assert.equal(pathMatchesRoot('packages/db/src/index.ts', 'packages/db/src/*.ts'), true)
	assert.equal(pathMatchesRoot('packages/db/src/schema/product.ts', 'packages/db/src/*.ts'), false)
})

test('classifies using map order and exclusions', () => {
	const paths = [
		'packages/core/src/net/identity.ts',
		'packages/core/src/net/guard.ts',
		'packages/db/src/queue.ts',
		'packages/db/src/migrate.ts',
		'packages/db/src/index.ts',
		'packages/db/src/schema/auth.ts',
		'apps/web/Dockerfile',
		'unknown.txt',
	]
	const { matched, unmatched } = classifyPaths(paths, loadPrimitivesMap())
	assert.deepEqual(Object.fromEntries(matched.map(({ primitive, files }) => [primitive.id, files])), {
		'app-db': ['packages/db/src/index.ts', 'packages/db/src/schema/auth.ts'],
		'browser-identity': ['packages/core/src/net/identity.ts'],
		'build-config': ['apps/web/Dockerfile'],
		'job-queue': ['packages/db/src/queue.ts'],
		migrations: ['packages/db/src/migrate.ts'],
		'outbound-network-guard': ['packages/core/src/net/guard.ts'],
	})
	assert.deepEqual(unmatched, ['unknown.txt'])
})

test('reports unmatched code globs and missing documentation', (t) => {
	const root = mkdtempSync(join(tmpdir(), 'primitives-map-'))
	t.after(() => rmSync(root, { recursive: true, force: true }))
	mkdirSync(join(root, 'src'))
	writeFileSync(join(root, 'src/index.ts'), '')
	const map = parsePrimitivesMap(`primitives:
  - id: example
    code:
      - src/*.ts
      - src/*.missing
    docs:
      - missing.md
`)
	assert.deepEqual(checkPrimitivesMapPaths(map, root).map(({ path }) => path), ['missing.md', 'src/*.missing'])
})

test('both CLIs find the map when invoked from another directory', () => {
	const output = execFileSync(process.execPath, [
		join(import.meta.dirname, 'classify-primitives.mjs'), '--stdin', '--json',
	], { cwd: tmpdir(), input: 'packages/api/src/index.ts\n', encoding: 'utf8' })
	assert.equal(JSON.parse(output).matched[0].id, 'api-router')
	const check = execFileSync(process.execPath, [
		join(import.meta.dirname, 'check-primitives-map.mjs'),
	], { cwd: tmpdir(), encoding: 'utf8' })
	assert.match(check, /primitives map ok:/)
})
