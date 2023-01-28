import { autoDetectClient, BatchV1Api, CoreV1Api, Job } from "./deps.ts";

import { Build, BuildConfig, BuildDanopiaNetV1Api } from "./build.danopia.net@v1/mod.ts";
import { updateArgoImageRefs } from "./argocd.ts";
import { Quantity } from "https://deno.land/x/kubernetes_apis@v0.3.2/common.ts";

const kubernetes = await autoDetectClient();
const coreApi = new CoreV1Api(kubernetes);
const batchApi = new BatchV1Api(kubernetes);
const crdApi = new BuildDanopiaNetV1Api(kubernetes);

const jobNamespace = "image-builds"; // TODO

export async function checkBuildConfigs() {
  console.log('Checking all BuildConfigs...');
  const allConfigs = await crdApi.getBuildConfigListForAllNamespaces();
  for (const config of allConfigs.items) {

    if (typeof config.status?.lastVersion != 'number') {
      await createBuild(config, 1);
    } else if ((config.metadata?.labels ?? {})['build.danopia.net/trigger-now'] == 'true') {
      await createBuild(config, (config.status.lastVersion ?? -2) + 1);
    }
  }
}

export async function checkBuilds() {
  console.log('Checking all Builds...');
  const allBuilds = await crdApi.getBuildListForAllNamespaces();
  for (const buildRes of allBuilds.items) {
    if (!buildRes.status || buildRes.status?.phase == 'New') {
      console.log('Build needs status!', buildRes.metadata?.name);

      const jobRes = await createBuildJob(buildRes);
      console.log(`Job created: ${jobRes.metadata?.namespace}/${jobRes.metadata?.name}`);

      await crdApi.namespace(buildRes.metadata?.namespace!).replaceBuildStatus(buildRes.metadata?.name!, {
        metadata: buildRes.metadata,
        status: {
          phase: 'Pending',
          startTimestamp: jobRes.status?.startTime,
        },
      });
      await updateBuildState(buildRes, jobRes);

    } else if (buildRes.status.phase !== 'Complete' && buildRes.status.phase !== 'Failed') {
      const jobRes = await batchApi.namespace(jobNamespace).getJobStatus(buildRes.metadata?.name!);
      console.log(`Job found: ${jobRes.metadata?.namespace}/${jobRes.metadata?.name}`);
      await updateBuildState(buildRes, jobRes);
    }
  }
}

async function createBuild(configRes: BuildConfig, buildNum: number) {
  const build = await crdApi.namespace(configRes.metadata?.namespace!).createBuild({
    metadata: {
      name: `${configRes.metadata?.name}-h${buildNum}`,
      ownerReferences: [{
        apiVersion: 'build.danopia.net/v1',
        kind: 'BuildConfig',
        name: configRes.metadata?.name!,
        uid: configRes.metadata?.uid!,
        controller: true,
      }],
      labels: {
        buildconfig: configRes.metadata?.name!,
        'build.danopia.net/config.name': configRes.metadata?.name!,
        'build.danopia.net/start-policy': configRes.spec.runPolicy!,
      },
      annotations: {
        'build.danopia.net/config.name': configRes.metadata?.name!,
        'build.danopia.net/number': `${buildNum}`,
        // 'build.danopia.net/pod-name': 'TODO',
      },
    },
    spec: {
      strategy: configRes.spec.strategy,
      completionDeadlineSeconds: configRes.spec.completionDeadlineSeconds,
      nodeSelector: configRes.spec.nodeSelector,
      output: configRes.spec.output,
      postCommit: configRes.spec.postCommit,
      resources: configRes.spec.resources,
      revision: configRes.spec.revision,
      serviceAccount: configRes.spec.serviceAccount,
      source: configRes.spec.source,
      triggeredBy: [{
        message: 'TODO: proper triggeredBy',
      }],
    },
  });

  // TODO: cleaner way of removing annotation, if it's even there
  configRes = await crdApi
    .namespace(configRes.metadata?.namespace!)
    .patchBuildConfig(configRes.metadata?.name!, 'json-merge', {
      metadata: {
        labels: {
          'build.danopia.net/trigger-now': 'false',
        },
      },
      spec: {} as any,
    });

  await crdApi
    .namespace(configRes.metadata?.namespace!)
    .replaceBuildConfigStatus(configRes.metadata?.name!, {
      ...configRes,
      status: {
        lastVersion: buildNum,
      },
    });

  const jobRes = await createBuildJob(build);

  await updateBuildState(build, jobRes);
}

async function updateBuildState(buildRes: Build, jobRes: Job) {
  const status: Build['status'] = {
    config: {
      kind: 'BuildConfig',
      name: buildRes.metadata?.name,
      namespace: buildRes.metadata?.namespace,
    },
    startTimestamp: jobRes.status?.startTime,
    completionTimestamp: jobRes.status?.completionTime,
    phase: 'New',
    conditions: [],
  }

  switch (true) {
    case !!jobRes.status?.succeeded:
      status.phase = 'Complete';
      status.conditions = [{
        lastTransitionTime: jobRes.metadata?.creationTimestamp,
        lastUpdateTime: jobRes.metadata?.creationTimestamp,
        status: "False",
        type: "New",
      }, {
        lastTransitionTime: jobRes.status?.startTime,
        lastUpdateTime: jobRes.status?.startTime,
        status: "False",
        type: "Pending",
      }, {
        lastTransitionTime: jobRes.status?.completionTime,
        lastUpdateTime: jobRes.status?.completionTime,
        status: "False",
        type: "Running",
      }, {
        lastTransitionTime: jobRes.status?.completionTime,
        lastUpdateTime: jobRes.status?.completionTime,
        status: "True",
        type: "Complete",
      }];
      break;
    case !!jobRes.status?.failed:
      status.phase = 'Failed';
      status.conditions = [{
        lastTransitionTime: jobRes.metadata?.creationTimestamp,
        lastUpdateTime: jobRes.metadata?.creationTimestamp,
        status: "False",
        type: "New",
      }, {
        lastTransitionTime: jobRes.status?.startTime,
        lastUpdateTime: jobRes.status?.startTime,
        status: "False",
        type: "Pending",
      }, {
        lastTransitionTime: jobRes.status?.conditions?.[0]?.lastTransitionTime,
        lastUpdateTime: jobRes.status?.conditions?.[0]?.lastTransitionTime,
        status: "False",
        type: "Running",
      }, {
        lastTransitionTime: jobRes.status?.conditions?.[0]?.lastTransitionTime,
        lastUpdateTime: jobRes.status?.conditions?.[0]?.lastTransitionTime,
        status: "True",
        type: "Complete",
      }];
      break;
    case !!jobRes.status?.active:
      status.phase = 'Running';
      status.conditions = [{
        lastTransitionTime: jobRes.metadata?.creationTimestamp,
        lastUpdateTime: jobRes.metadata?.creationTimestamp,
        status: "False",
        type: "New",
      }, {
        lastTransitionTime: jobRes.status?.startTime,
        lastUpdateTime: jobRes.status?.startTime,
        status: "False",
        type: "Pending",
      }, {
        lastTransitionTime: jobRes.status?.startTime,
        lastUpdateTime: jobRes.status?.startTime,
        status: "True",
        type: "Running",
      }, {
        lastTransitionTime: buildRes.metadata?.creationTimestamp,
        lastUpdateTime: buildRes.metadata?.creationTimestamp,
        status: "False",
        type: "Complete",
      }];
      break;
    default:
      status.phase = 'Pending';
      status.conditions = [{
        lastTransitionTime: jobRes.metadata?.creationTimestamp,
        lastUpdateTime: jobRes.metadata?.creationTimestamp,
        status: "False",
        type: "New",
      }, {
        lastTransitionTime: jobRes.metadata?.creationTimestamp,
        lastUpdateTime: jobRes.metadata?.creationTimestamp,
        status: "True",
        type: "Pending",
      }, {
        lastTransitionTime: buildRes.metadata?.creationTimestamp,
        lastUpdateTime: buildRes.metadata?.creationTimestamp,
        status: "True",
        type: "Running",
      }, {
        lastTransitionTime: buildRes.metadata?.creationTimestamp,
        lastUpdateTime: buildRes.metadata?.creationTimestamp,
        status: "False",
        type: "Complete",
      }];
      break;
  }

  if (status.phase == 'Failed') {
    const podList = await coreApi.namespace(jobRes.metadata?.namespace!).getPodList({
      labelSelector: 'job-name='+jobRes.metadata?.name,
      fieldSelector: 'status.phase=Failed',
      limit: 1,
    });
    const [podRes] = podList.items;
    if (!podRes) throw new Error(`Where did our pod go for ${jobRes.metadata?.name}??`);

    const podLog = await coreApi.namespace(podRes.metadata?.namespace!).getPodLog(podRes.metadata?.name!);
    const podLogLines = podLog.split('\n');
    status.logSnippet = podLogLines.slice(-25).join('\n');

    const endTime = podRes
      .status?.conditions
      ?.find(x => x.type == 'Ready')
      ?.lastTransitionTime;
    if (endTime && status?.startTimestamp) {
      const durationMilliseconds = endTime.valueOf() - status.startTimestamp.valueOf();
      status.duration = Math.round(durationMilliseconds / 1000 * 1_000_000_000);
      // rounded nanos? e.g. 55000000000
    }

    buildRes = await crdApi.namespace(buildRes.metadata?.namespace!).patchBuild(buildRes.metadata?.name!, 'json-merge', {
      metadata: {
        annotations: {
          'build.danopia.net/pod-name': podRes.metadata?.name!,
        },
      },
    });

  }

  if (status.phase == 'Complete') {
    const podList = await coreApi.namespace(jobRes.metadata?.namespace!).getPodList({
      labelSelector: 'job-name='+jobRes.metadata?.name,
      fieldSelector: 'status.phase=Succeeded',
      limit: 1,
    });
    const [podRes] = podList.items;
    if (!podRes) throw new Error(`Where did our pod go for ${jobRes.metadata?.name}??`);

    const podLog = await coreApi.namespace(podRes.metadata?.namespace!).getPodLog(podRes.metadata?.name!);
    const podLogLines = podLog.split('\n');

    const knownDigest = podLogLines.find(x => x.startsWith('build.danopia.net digest='))?.split('=')[1];
    console.log('Found image digest in output:', knownDigest);
    if (!knownDigest) throw new Error(`No knownDigest found`);

    // const startIdx = podLogLines.indexOf('+ buildah images --json dev');
    // const endIdx = podLogLines.indexOf(']', startIdx);
    // if (startIdx < 0 || endIdx < 0) throw new Error(`No JSON found in docker build output`);
    // const jsonOut = JSON.parse(podLogLines.slice(startIdx+1, endIdx+1).join('')) as Array<{
    //   id: string;
    //   names: Array<string>;
    //   digest: string;
    //   createdat: string;
    //   size: string;
    //   created: number;
    //   createdatraw: string;
    //   readonly: boolean;
    //   history: unknown;
    // }>;
    // const [image] = jsonOut.filter(x => x.names.includes('localhost/dev:latest'));
    // if (!image) throw new Error(`No image from docker build step`);

    status.output = {
      to: {
        imageDigest: knownDigest,
      },
    };

    { // TODO: this is already decided elsewhere, don't recalculate
      const outputToName = buildRes.spec?.output?.to?.name;
      const targetRef =
        outputToName?.includes('/')
          ? outputToName
          : 'rg.nl-ams.scw.cloud/danopia-k8s-apps/'+outputToName;
      status.outputDockerImageReference = `${targetRef.replace(/:[^/]+/, '')+'@'+knownDigest}`;
    }

    const buildConfigName = buildRes.metadata?.labels?.['build.danopia.net/config.name'];
    if (buildConfigName && status.outputDockerImageReference) {
      await updateArgoImageRefs(kubernetes, {
        argoNamespace: 'argocd',
        imageName: buildConfigName,
        newRef: status.outputDockerImageReference,
      });
      console.log('Checked ArgoCD images')
    }

    // status.stages = [{
    //   durationMilliseconds: 345,
    //   name: 'FetchInputs',
    //   startTime: new Date("2022-10-23T17:49:10Z"),
    //   steps: [{
    //     durationMilliseconds: 345,
    //     name: 'FetchGitSource',
    //     startTime: new Date("2022-10-23T17:49:10Z"),
    //   }],
    // }];
    // - durationMilliseconds: 19373
    //   name: PullImages
    //   startTime: "2022-10-23T17:49:12Z"
    //   steps:
    //   - durationMilliseconds: 19373
    //     name: PullBaseImage
    //     startTime: "2022-10-23T17:49:12Z"
    // - durationMilliseconds: 24327
    //   name: Build
    //   startTime: "2022-10-23T17:49:32Z"
    //   steps:
    //   - durationMilliseconds: 24327
    //     name: DockerBuild
    //     startTime: "2022-10-23T17:49:32Z"
    // - durationMilliseconds: 3311
    //   name: PushImage
    //   startTime: "2022-10-23T17:49:56Z"
    //   steps:
    //   - durationMilliseconds: 3311
    //     name: PushImage
    //     startTime: "2022-10-23T17:49:56Z"


    if (status?.completionTimestamp && status?.startTimestamp) {
      const durationMilliseconds = status.completionTimestamp.valueOf() - status.startTimestamp.valueOf();
      status.duration = Math.round(durationMilliseconds / 1000 * 1_000_000_000);
      // rounded nanos? e.g. 55000000000
    }

    buildRes = await crdApi.namespace(buildRes.metadata?.namespace!).patchBuild(buildRes.metadata?.name!, 'json-merge', {
      metadata: {
        annotations: {
          'build.danopia.net/pod-name': podRes.metadata?.name!,
        },
      },
    });

    console.log(`Job completed: ${jobRes.metadata?.namespace}/${jobRes.metadata?.name}`);
  }

  await crdApi.namespace(buildRes.metadata?.namespace!).replaceBuildStatus(buildRes.metadata?.name!, {
    metadata: buildRes.metadata,
    status,
  });
}

async function createBuildJob(buildRes: Build) {
  if (buildRes.spec?.source?.type !== 'Git') {
    throw new Error(`TODO: non-git source types`);
  }
  if (buildRes.spec?.strategy.type !== 'Docker') {
    throw new Error(`TODO: non-Docker strategy types`);
  }
  if (buildRes.spec?.output?.to?.kind !== 'DockerImage') {
    throw new Error(`TODO: non-DockerImage output types`);
  }

  const outputToName = buildRes.spec?.output?.to?.name;
  const targetRef =
    outputToName?.includes('/')
      ? outputToName
      : 'rg.nl-ams.scw.cloud/danopia-k8s-apps/'+outputToName;

  return await batchApi.namespace(jobNamespace).createJob({
    metadata: {
      name: buildRes.metadata?.name,
      // ownerReferences: [{
      //   apiVersion: 'build.danopia.net/v1',
      //   kind: 'Build',
      //   name: buildRes.metadata?.name!,
      //   uid: buildRes.metadata?.uid!,
      // }],
    },
    spec: {
      ttlSecondsAfterFinished: 60 * 60,
      template: {
        spec: {
          nodeSelector: buildRes.spec.nodeSelector,
          serviceAccountName: buildRes.spec.serviceAccount,
          containers: [{
            name: 'build',
            securityContext: {
              privileged: true,
            },
            resources: {
              requests: {
                cpu: new Quantity(1000, 'm'),
                memory: new Quantity(4, 'Gi'),
              },
              limits: {
                cpu: new Quantity(1000, 'm'),
                memory: new Quantity(4, 'Gi'),
              },
            },
            // image: 'quay.io/buildah/stable',
            image: 'rg.nl-ams.scw.cloud/danopia-k8s-apps/image-buildah', // has git :)
            command: ['bash', '-euxc', `
              ${buildRes.spec.source.git
                ? `git clone -- "$SOURCE_CONTEXT" app`
                : `mkdir -p app/"$CONTEXT_DIR"`}
              cd app/"$CONTEXT_DIR"
              ${buildRes.spec.source.dockerfile
                ? `echo "${btoa(buildRes.spec.source.dockerfile)}" | base64 --decode > Dockerfile`
                : '# using dockerfile from repo'}
              buildah bud -t "$TARGET_IMAGE" .
              buildah push --digestfile digestfile -- "$TARGET_IMAGE"
              echo "build.danopia.net digest=$(cat digestfile)"
            `.replace(/^ +/gm, '')],
            env: [{
              name: 'SOURCE_CONTEXT',
              value: buildRes.spec?.source?.git?.uri,
            }, {
              name: 'CONTEXT_DIR',
              value: buildRes.spec?.source?.contextDir ?? '',
            }, {
              name: 'TARGET_IMAGE',
              value: targetRef,
            }, {
              name: 'REGISTRY_AUTH_FILE',
              value: '/var/secret/registry/.dockerconfigjson',
            }, {
              name: 'BUILDAH_LAYERS',
              value: 'true',
            }],
            volumeMounts: [{
              name: 'containers',
              mountPath: '/var/lib/containers',
            }, {
              name: 'auth',
              readOnly: true,
              mountPath: '/var/secret/registry',
            }],
          }],
          volumes: [{
            name: 'containers',
            hostPath: {
              path: '/tmp/k8s-buildah-containers',
            },
          }, {
            name: 'auth',
            secret: {
              secretName: 'scaleway-registry-token',
            },
          }],
          restartPolicy: 'Never',
        },
      },
      backoffLimit: 0,
    },
  });
}
