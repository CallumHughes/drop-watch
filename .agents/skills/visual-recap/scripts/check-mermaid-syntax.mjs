#!/usr/bin/env node
// Parses every ```mermaid fence in a recap block with mermaid's own parser.
//   check-mermaid-syntax.mjs [--stdin | <file>] [--label <name>]

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const FENCE = /^```mermaid[^\S\r\n]*\r?\n([\s\S]*?)^```[^\S\r\n]*$/gmu

export function mermaidBlocks(markdown) {
	return [...markdown.matchAll(FENCE)].map((match) => match[1])
}

let parser

async function loadParser() {
	if (!parser) {
		// mermaid touches window/document at import time, so the DOM goes first.
		const { JSDOM } = await import('jsdom')
		const { window } = new JSDOM('<!doctype html><body></body>')
		globalThis.window = window
		globalThis.document = window.document
		parser = (await import('mermaid')).default
	}
	return parser
}

/** One entry per failing diagram, empty when all parse. */
export async function checkMermaid(markdown) {
	const mermaid = await loadParser()
	const failures = []
	for (const [index, diagram] of mermaidBlocks(markdown).entries()) {
		try {
			await mermaid.parse(diagram)
		} catch (error) {
			failures.push({ index, message: error instanceof Error ? error.message : String(error) })
		}
	}
	return failures
}

async function main() {
	const args = process.argv.slice(2)
	const labelAt = args.indexOf('--label')
	const label = labelAt === -1 ? undefined : args[labelAt + 1]
	const file = args.find((arg, i) => !arg.startsWith('--') && (labelAt === -1 || i !== labelAt + 1))
	const markdown = args.includes('--stdin') ? readFileSync(0, 'utf8') : file ? readFileSync(file, 'utf8') : null
	if (markdown === null) {
		console.error('usage: check-mermaid-syntax.mjs [--stdin | <file>] [--label <name>]')
		process.exit(1)
	}

	const name = label ?? file ?? 'stdin'
	const failures = await checkMermaid(markdown)
	for (const { index, message } of failures) {
		console.error(`${name}: mermaid diagram ${index + 1} does not parse\n${message}`)
	}
	process.exit(failures.length === 0 ? 0 : 1)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
	await main()
}
