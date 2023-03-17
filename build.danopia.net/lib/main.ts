#!/usr/bin/env -S deno run --unstable --allow-all

import { fixedInterval } from "./deps.ts";

import { checkBuildConfigs, checkBuilds } from "./logic.ts";
import { trace } from "./tracer.ts";

const tracer = trace.getTracer('operator-loop');

for await (const _ of fixedInterval(10 * 1000)) {
  console.log('---', new Date());

  await tracer.startActiveSpan('checkBuildConfigs', {}, span =>
    checkBuildConfigs()
      .catch(err => span.recordException(err))
      .finally(() => span.end()));

  await tracer.startActiveSpan('checkBuilds', {}, span =>
    checkBuilds()
      .catch(err => span.recordException(err))
      .finally(() => span.end()));

}
