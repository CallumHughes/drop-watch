import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { createContext } from "@price-tracker/api/context";
import { appRouter } from "@price-tracker/api/routers/index";
import type { NextRequest } from "next/server";

import { log, withEvlog } from "@/lib/evlog";
import { identifyEvlogUser } from "@/lib/evlog-auth";

// oRPC still turns the error into the wire response after interceptors run;
// these only record it as a structured evlog event instead of dumping the raw
// object to stdout.
const logHandlerError = (action: string, error: unknown) => {
  const cause = error instanceof Error ? error : new Error(String(error));
  log.error({ action, error: cause.message, stack: cause.stack });
};

const rpcHandler = new RPCHandler(appRouter, {
  interceptors: [
    onError((error) => {
      logHandlerError("rpc_error", error);
    }),
  ],
});
const apiHandler = new OpenAPIHandler(appRouter, {
  interceptors: [
    onError((error) => {
      logHandlerError("openapi_error", error);
    }),
  ],
  plugins: [
    new OpenAPIReferencePlugin({
      schemaConverters: [new ZodToJsonSchemaConverter()],
    }),
  ],
});

async function handleRequest(req: NextRequest) {
  await identifyEvlogUser(req);
  // Build the context once and share it: createContext does a session lookup,
  // and the OpenAPI fallthrough below would otherwise pay for it twice.
  const context = await createContext(req);
  const rpcResult = await rpcHandler.handle(req, {
    context,
    prefix: "/api/rpc",
  });
  if (rpcResult.response) {
    return rpcResult.response;
  }

  const apiResult = await apiHandler.handle(req, {
    context,
    prefix: "/api/rpc/api-reference",
  });
  if (apiResult.response) {
    return apiResult.response;
  }

  return new Response("Not found", { status: 404 });
}

export const GET = withEvlog(handleRequest);
export const POST = withEvlog(handleRequest);
export const PUT = withEvlog(handleRequest);
export const PATCH = withEvlog(handleRequest);
export const DELETE = withEvlog(handleRequest);
