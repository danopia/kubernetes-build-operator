#!/usr/bin/env -S deno run --unstable --allow-all

import "https://deno.land/x/observability@v0.7.0/preconfigured/from-environment.ts";
import { fixedInterval } from "./deps.ts";

import { checkBuildConfigs, checkBuilds } from "./logic.ts";
import { trace } from "https://deno.land/x/observability@v0.7.0/opentelemetry/api.js";

const loopTracer = trace.getTracer('loop');

for await (const _ of fixedInterval(30 * 1000)) {
  console.log('---', new Date());

  await loopTracer.startActiveSpan('main', {}, async rootSpan => {
    try {

      await checkBuildConfigs();
      await checkBuilds()

    } finally {
      rootSpan.end();
    }
  });
}
