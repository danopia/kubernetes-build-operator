import { RestClient, ArgoprojIoV1alpha1NamespacedApi } from "./deps.ts";

/**
 * Goes through every Application registered to ArgoCD looking at kustomize images.
 * When the image is found, it will be updated to the newest target.
 */
export async function updateArgoImageRefs(kubernetes: RestClient, opts: {
  argoNamespace: string;
  imageName: string;
  newRef: string;
}) {
  const argoApi = new ArgoprojIoV1alpha1NamespacedApi(kubernetes, opts.argoNamespace);

  const appList = await argoApi.getApplicationList();
  for (const app of appList.items) {
    const prevImages = app.spec.source.kustomize?.images;
    if (!prevImages?.length) continue;

    const newImages = prevImages.map(image => {
      const parts = image.split('=');
      if (parts[0] !== opts.imageName) return image;
      return [parts[0], opts.newRef].join('=');
    });
    if (JSON.stringify(newImages) == JSON.stringify(prevImages)) continue;

    await argoApi.patchApplication(app.metadata.name!, 'json-patch', [{
      op: 'replace',
      path: '/spec/source/kustomize/images',
      value: newImages,
    }]);
    console.log('Updated ArgoCD image for', app.metadata.name);
  }
}
