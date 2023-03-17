export { autoDetectClient } from "https://deno.land/x/kubernetes_client@v0.4.0/transports/mod.ts";

export type { RestClient } from "https://deno.land/x/kubernetes_apis@v0.3.2/common.ts";
export { CoreV1Api } from "https://deno.land/x/kubernetes_apis@v0.3.2/builtin/core@v1/mod.ts";
export { BatchV1Api } from "https://deno.land/x/kubernetes_apis@v0.3.2/builtin/batch@v1/mod.ts";
export type { Job } from "https://deno.land/x/kubernetes_apis@v0.3.2/builtin/batch@v1/mod.ts";
export { ArgoprojIoV1alpha1NamespacedApi } from "https://deno.land/x/kubernetes_apis@v0.3.2/argo-cd/argoproj.io@v1alpha1/mod.ts";

export { fixedInterval } from "https://crux.land/4MC9JG#fixed-interval";

export { trace } from "https://deno.land/x/observability@v0.3.0/api.ts";
