/**
 * Shared parser + path classifier for docs/architecture/primitives.yaml.
 *
 * Constrained YAML subset used by the repository map: group mappings, primitive
 * and invariant records, folded text, and path lists. Not a general YAML parser.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { minimatch } from 'minimatch'

export const defaultMapPath = resolve(
	import.meta.dirname,
	'../../../../docs/architecture/primitives.yaml',
)

/**
 * @typedef {{
 *   id: string
 *   name: string
 *   group?: string
 *   summary?: string
 *   code: Array<string>
 *   docs: Array<string>
 *   excludes: Array<string>
 * }} Primitive
 */

/**
 * @typedef {{
 *   version: number
 *   groups: Array<{ id: string, name: string }>
 *   primitives: Array<Primitive>
 *   invariants: Array<Primitive>
 * }} PrimitivesMap
 */

/**
 * @param {string} text
 * @returns {PrimitivesMap}
 */
export function parsePrimitivesMap(text) {
	const lines = text.split(/\r?\n/)
	/** @type {PrimitivesMap} */
	const map = {
		version: 1,
		groups: [],
		primitives: [],
		invariants: [],
	}

	/** @type {'root' | 'groups' | 'primitives' | 'invariants'} */
	let section = 'root'
	/** @type {Primitive | { id: string, name: string } | null} */
	let current = null
	/** @type {'code' | 'docs' | 'excludes' | null} */
	let listField = null
	let foldedSummary = false
	let summaryIndent = null

	function finishCurrent() {
		if (!current || !('id' in current)) return
		if (section === 'groups' && 'name' in current) {
			map.groups.push({ id: current.id, name: current.name })
		} else if (section === 'primitives') {
			const primitive = /** @type {Primitive} */ (current)
			primitive.code ??= []
			primitive.docs ??= []
			primitive.excludes ??= []
			map.primitives.push(primitive)
		} else if (section === 'invariants') {
			const invariant = /** @type {Primitive} */ (current)
			invariant.code ??= []
			invariant.docs ??= []
			invariant.excludes ??= []
			map.invariants.push(invariant)
		}
		current = null
		listField = null
		foldedSummary = false
		summaryIndent = null
	}

	for (const rawLine of lines) {
		const line = rawLine
		if (foldedSummary && line.trim()) {
			const indent = line.match(/^ */)[0].length
			if (indent >= (summaryIndent ?? 5)) {
				summaryIndent ??= indent
				current.summary = `${current.summary} ${line.trim()}`.trim()
				continue
			}
			foldedSummary = false
		}
		if (!line.trim() || /^\s*#/.test(line)) continue

		const sectionMatch = line.match(/^(groups|primitives|invariants):\s*$/)
		if (sectionMatch) {
			finishCurrent()
			section = /** @type {'groups' | 'primitives' | 'invariants'} */ (
				sectionMatch[1]
			)
			continue
		}

		const versionMatch = line.match(/^version:\s+(\d+)\s*$/)
		if (versionMatch) {
			map.version = Number(versionMatch[1])
			continue
		}

		const groupMatch = line.match(/^ {2}([\w-]+):\s+(.+?)\s*$/)
		if (section === 'groups' && groupMatch) {
			map.groups.push({ id: groupMatch[1], name: unquote(groupMatch[2]) })
			continue
		}

		const itemMatch = line.match(/^ {2}- id:\s+(.+?)\s*$/)
		if (itemMatch) {
			finishCurrent()
			current = {
				id: unquote(itemMatch[1]),
				name: unquote(itemMatch[1]),
				code: [],
				docs: [],
				excludes: [],
			}
			listField = null
			continue
		}

		if (!current) continue

		const listStart = line.match(/^ {4}(code|docs|excludes):\s*$/)
		if (listStart) {
			listField = /** @type {'code' | 'docs' | 'excludes'} */ (listStart[1])
			foldedSummary = false
			continue
		}

		const listItem = line.match(/^ {6}- (.+?)\s*$/)
		if (listItem && listField && 'code' in current) {
			const value = unquote(listItem[1])
			current[listField].push(value)
			continue
		}

		foldedSummary = false
		listField = null

		const fieldMatch = line.match(/^ {4}(group|name|summary|statement):\s+(.+?)\s*$/)
		if (fieldMatch) {
			listField = null
			const key = fieldMatch[1]
			const value = unquote(fieldMatch[2])
			if (key === 'group') current.group = value
			else if (key === 'name') current.name = value
			else {
				const indicator = fieldMatch[2].replace(/\s+#.*$/, '')
				if (/^\|[1-9+-]*$/.test(indicator)) {
					throw new Error(`Literal block scalars are unsupported for ${key}; use folded > text instead`)
				}
				const foldedMatch = indicator.match(/^>(?:([1-9])[+-]?|[+-]([1-9])?)?$/)
				if (indicator.startsWith('>') && !foldedMatch) {
					throw new Error(`Unsupported folded block indicator: ${indicator}`)
				}
				foldedSummary = foldedMatch !== null
				const indent = foldedMatch?.[1] ?? foldedMatch?.[2]
				summaryIndent = indent ? 4 + Number(indent) : null
				current.summary = foldedSummary ? '' : value
			}
		}
	}

	finishCurrent()
	return map
}

/**
 * @param {string} value
 */
function unquote(value) {
	if (
		(value.startsWith("'") && value.endsWith("'")) ||
		(value.startsWith('"') && value.endsWith('"'))
	) {
		return value.slice(1, -1)
	}
	return value
}

/**
 * @param {string} filePath
 * @param {string} root
 */
export function pathMatchesRoot(filePath, root) {
	const normalizedFile = filePath.replaceAll('\\', '/')
	const normalizedRoot = root.replaceAll('\\', '/')
	if (!normalizedRoot) return false
	return minimatch(normalizedFile, normalizedRoot, { dot: true })
}

/**
 * First matching primitive wins, following the order in the repository map.
 * Exclusions apply before testing a primitive's code globs.
 *
 * @param {Array<string>} paths
 * @param {PrimitivesMap} map
 */
export function classifyPaths(paths, map) {
	/** @type {Map<string, { primitive: Primitive, root: string, files: Array<string> }>} */
	const byId = new Map()
	/** @type {Array<string>} */
	const unmatched = []

	for (const rawPath of paths) {
		const filePath = rawPath.replaceAll('\\', '/').replace(/^\.\//, '')
		if (!filePath || filePath.endsWith('/')) continue

		const primitive = map.primitives.find((entry) =>
			!entry.excludes.some((glob) => pathMatchesRoot(filePath, glob)) &&
			entry.code.some((glob) => pathMatchesRoot(filePath, glob)),
		)
		if (!primitive) {
			unmatched.push(filePath)
			continue
		}

		const existing = byId.get(primitive.id)
		if (existing) {
			existing.files.push(filePath)
		} else {
			byId.set(primitive.id, {
				primitive,
				root: primitive.code.find((glob) => pathMatchesRoot(filePath, glob)),
				files: [filePath],
			})
		}
	}

	const matched = [...byId.values()].sort((a, b) =>
		a.primitive.id.localeCompare(b.primitive.id),
	)
	return { matched, unmatched }
}

/**
 * @param {string} [mapPath]
 */
export function loadPrimitivesMap(mapPath = defaultMapPath) {
	return parsePrimitivesMap(readFileSync(mapPath, 'utf8'))
}

/**
 * Validate that every `code`, `docs`, and `excludes` path resolves on disk.
 * Code globs must match at least one existing path under the repo root.
 * Exclusions must overlap an entry's code globs.
 *
 * @param {PrimitivesMap} map
 * @param {string} [repoRoot]
 */
export function checkPrimitivesMapPaths(
	map,
	repoRoot = resolve(import.meta.dirname, '../../../..'),
) {
	/** @type {Array<{ kind: string, id: string, path: string, reason: string }>} */
	const errors = []
	const paths = listPaths(repoRoot)

	/**
	 * @param {Primitive} entry
	 * @param {'primitive' | 'invariant'} kind
	 */
	function checkEntry(entry, kind) {
		for (const docPath of entry.docs) {
			const absolute = resolve(repoRoot, docPath)
			if (!existsSync(absolute) || !statSync(absolute).isFile()) {
				errors.push({
					kind,
					id: entry.id,
					path: docPath,
					reason: 'docs path missing or not a file',
				})
			}
		}

		for (const codePath of entry.code) {
			if (paths.some((path) => pathMatchesRoot(path, codePath))) continue

			errors.push({
				kind,
				id: entry.id,
				path: codePath,
				reason: 'code root missing on disk',
			})
		}

		for (const excludedPath of entry.excludes) {
			if (paths.some((path) =>
				pathMatchesRoot(path, excludedPath) &&
				entry.code.some((codePath) => pathMatchesRoot(path, codePath)),
			)) continue
			errors.push({
				kind,
				id: entry.id,
				path: excludedPath,
				reason: 'exclusion matches no existing path within code globs',
			})
		}
	}

	for (const primitive of map.primitives) checkEntry(primitive, 'primitive')
	for (const invariant of map.invariants) checkEntry(invariant, 'invariant')
	return errors
}

/** @param {string} repoRoot */
function listPaths(repoRoot) {
	try {
		const options = {
			cwd: repoRoot,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
			maxBuffer: 16 * 1024 * 1024,
		}
		const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], options).replace(/\r?\n$/, '')
		if (realpathSync(gitRoot) === realpathSync(repoRoot)) {
			const output = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], options)
			const paths = new Set()
			for (const file of output.split('\0').filter(Boolean)) {
				if (!existsSync(resolve(repoRoot, file))) continue
				paths.add(file)
				let parent = file
				while (parent.includes('/')) {
					parent = parent.slice(0, parent.lastIndexOf('/'))
					paths.add(parent)
				}
			}
			return [...paths]
		}
	} catch (error) {
		if (error.status !== 128 && error.code !== 'ENOENT') throw error
	}

	// Archive exports and standalone fixtures have no Git index.
	const paths = []
	function visit(directory) {
		let entries
		try {
			entries = readdirSync(resolve(repoRoot, directory), { withFileTypes: true })
		} catch (error) {
			if (['EACCES', 'EPERM', 'ENOENT', 'ENOTDIR'].includes(error.code)) return
			throw error
		}
		for (const entry of entries) {
			if (['node_modules', '.git', '.next', '.next-e2e', '.turbo', 'dist', 'build', 'out', 'coverage', 'playwright-report', 'test-results'].includes(entry.name)) continue
			const path = directory ? `${directory}/${entry.name}` : entry.name
			paths.push(path)
			if (entry.isDirectory()) visit(path)
		}
	}
	visit('')
	return paths
}
