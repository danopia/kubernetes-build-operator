#!/bin/sh -eux

CodegenSrc="https://raw.githubusercontent.com/cloudydeno/deno-kubernetes_apis/main/generation/run-on-crds.ts"
ApisImportUrl="https://deno.land/x/kubernetes_apis@v0.4.0/"

deno run --allow-read=. --allow-write=lib "$CodegenSrc" deploy/crds . "$ApisImportUrl"

# TODO: extra semicolon after "export interface" blocks
