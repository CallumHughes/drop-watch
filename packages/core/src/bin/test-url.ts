/**
 * Manual smoke test for the extraction chain against a live URL.
 *
 *   pnpm --filter @drop-watch/core test-url <url> [--mode <mode>] [--expression <value>]
 *
 * Prints the fetch outcome and the extraction result, including which strategy
 * won. This is the tool used to verify new sites before wiring them up.
 */

import { extract } from "../extract/index";
import { EXPRESSION_MODES, type ExpressionMode } from "../extract/strategies";
import { fetchPage } from "../fetch/index";

const USAGE = `usage: test-url <url> [--mode ${EXPRESSION_MODES.join("|")}] [--expression <value>]
                    [--selector <css>] [--locale <tag>] [--json] [--timeout <ms>]`;

interface Args {
  expression?: string;
  json: boolean;
  locale?: string;
  mode?: ExpressionMode;
  timeoutMs?: number;
  url: string;
}

function isMode(value: string): value is ExpressionMode {
  return EXPRESSION_MODES.some((mode) => mode === value);
}

const VALUE_FLAGS = ["--selector", "--expression", "--mode", "--locale", "--timeout"];

/** Applies one `--flag value` pair; false when the value is not usable. */
function applyFlag(args: Partial<Args>, flag: string, value: string): boolean {
  if (flag === "--selector") {
    // Kept as an alias so existing muscle memory still works.
    args.expression = value;
    args.mode = "selector";
    return true;
  }
  if (flag === "--expression") {
    args.expression = value;
    return true;
  }
  if (flag === "--mode") {
    if (!isMode(value)) {
      return false;
    }
    args.mode = value;
    return true;
  }
  if (flag === "--locale") {
    args.locale = value;
    return true;
  }
  args.timeoutMs = Number(value);
  return true;
}

function parseArgs(argv: readonly string[]): Args | null {
  const positional: string[] = [];
  const args: Partial<Args> = { json: false };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token && VALUE_FLAGS.includes(token)) {
      const value = argv[i + 1];
      if (!(value && applyFlag(args, token, value))) {
        return null;
      }
      i += 1;
    } else if (token === "--json") {
      args.json = true;
    } else if (token) {
      positional.push(token);
    }
  }

  const [url] = positional;
  if (!url) {
    return null;
  }
  // An expression with no mode is a selector, matching the old flag's meaning.
  if (args.expression && !args.mode) {
    args.mode = "selector";
  }
  return { ...args, json: args.json ?? false, url };
}

function describe(label: string, value: string | undefined): string {
  return `  ${label.padEnd(10)} ${value ?? "—"}`;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error(USAGE);
    return 1;
  }

  const fetched = await fetchPage(args.url, args.timeoutMs ? { timeoutMs: args.timeoutMs } : {});
  if (fetched.status !== "ok") {
    console.error(`fetch ${fetched.status} after ${fetched.durationMs}ms`);
    if ("error" in fetched) {
      console.error(`  ${fetched.error}`);
    }
    return 1;
  }

  const result = extract(fetched.body, {
    ...(args.locale ? { locale: args.locale } : {}),
    ...(args.expression ? { expression: args.expression } : {}),
    // A mode pins the chain to it, so a rotted expression fails loudly here
    // exactly as it would on a scheduled check.
    ...(args.mode ? { strategies: [args.mode] } : {}),
    url: fetched.url,
  });

  if (args.json) {
    console.info(
      JSON.stringify(
        { durationMs: fetched.durationMs, httpStatus: fetched.httpStatus, result, url: args.url },
        null,
        2
      )
    );
    return result.ok ? 0 : 1;
  }

  console.info(`${args.url}`);
  console.info(
    `  HTTP ${fetched.httpStatus} · ${fetched.durationMs}ms · ${fetched.body.length} bytes`
  );

  if (!result.ok) {
    console.error(`  FAILED: ${result.error}`);
    return 1;
  }

  console.info(describe("strategy", result.strategy));
  console.info(describe("price", `${result.currency ?? ""} ${result.price}`.trim()));
  console.info(
    describe("stock", result.availability ?? (result.inStock === undefined ? undefined : "—"))
  );
  console.info(
    describe("inStock", result.inStock === undefined ? undefined : String(result.inStock))
  );
  console.info(describe("title", result.title));
  console.info(describe("image", result.imageUrl));
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
