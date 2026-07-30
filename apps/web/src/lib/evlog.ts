import { createEvlog } from "evlog/next";
import { createInstrumentation } from "evlog/next/instrumentation/create";

export const { withEvlog, useLogger, log, createError } = createEvlog({
  service: "drop-watch-web",
});

export const { register, onRequestError } = createInstrumentation({
  service: "drop-watch-web",
});
