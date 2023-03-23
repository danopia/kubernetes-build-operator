import { httpTracer, trace, DenoFetchInstrumentation, DenoTracerProvider, OTLPTraceFetchExporter, Resource } from "https://deno.land/x/observability@v0.3.1/mod.ts";
export { httpTracer, trace };

export const provider = new DenoTracerProvider({
  resource: new Resource({
    'service.name': 'build-operator',
    'deployment.environment': 'production',
  }),
  instrumentations: [
    new DenoFetchInstrumentation(),
  ],
  batchSpanProcessors: [
    new OTLPTraceFetchExporter(),
  ],
});
