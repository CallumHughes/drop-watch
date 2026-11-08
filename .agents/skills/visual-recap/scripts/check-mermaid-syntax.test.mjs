import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { checkMermaid, mermaidBlocks } from './check-mermaid-syntax.mjs'

const fence = (body) => `text\n\n\`\`\`mermaid\n${body}\n\`\`\`\n`

test('extracts only mermaid fences', () => {
	assert.deepEqual(mermaidBlocks(`${fence('graph TD\n  a-->b')}\`\`\`js\nx\n\`\`\``), ['graph TD\n  a-->b\n'])
})

test('passes a valid sequence diagram', async () => {
	assert.deepEqual(await checkMermaid(fence('sequenceDiagram\n\ta->>b: reads')), [])
})

test('reports the diagram that does not parse', async () => {
	const failures = await checkMermaid(fence('graph TD\n  a-->b') + fence('sequenceDiagram\n\ta->>: missing target'))
	assert.equal(failures.length, 1)
	assert.equal(failures[0].index, 1)
})

test('exits non-zero from stdin on a broken diagram', () => {
	const run = (input) =>
		spawnSync(process.execPath, [`${import.meta.dirname}/check-mermaid-syntax.mjs`, '--stdin', '--label', 'block'], {
			input,
			encoding: 'utf8',
		})
	assert.equal(run(fence('sequenceDiagram\n\ta->>b: ok')).status, 0)
	const broken = run(fence('sequenceDiagram\n\ta->>: missing target'))
	assert.equal(broken.status, 1)
	assert.match(broken.stderr, /block: mermaid diagram 1 does not parse/)
})
