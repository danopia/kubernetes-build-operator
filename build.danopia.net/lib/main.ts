#!/usr/bin/env -S deno run --unstable --allow-all

import { fixedInterval } from "./deps.ts";

import { checkBuildConfigs, checkBuilds } from "./logic.ts";

for await (const _ of fixedInterval(10 * 1000)) {
  console.log('---', new Date());
  await checkBuildConfigs();
  await checkBuilds();
}
