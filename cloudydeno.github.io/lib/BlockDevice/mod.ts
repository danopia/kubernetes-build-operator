import { autoDetectClient } from "https://deno.land/x/kubernetes_client@v0.5.0/mod.ts";
import { CloudydenoGithubIoV1Api, BlockDevice } from "../cloudydeno.github.io@v1/mod.ts";
import { dumpAll } from "./smartctl.ts";

const nodeName = Deno.args[0];
if (!nodeName) throw new Error(`Provide a node name as the first argument! (using downward API in Kubernetes, probably)`);
const petApi = new CloudydenoGithubIoV1Api(await autoDetectClient());

const knownDevs = await petApi.getBlockDeviceList({
  labelSelector: `cloudydeno.com/node=${nodeName}`,
});
const knownDevSerials = new Map(knownDevs.items.map(x => [x.spec.serialNumber, x.metadata?.resourceVersion]));

for (const info of await dumpAll()) {
  const isSpinningDisk = info.Information['Rotation Rate'] !== 'Solid State Device';
  const sectorSizeWords = (info.Information['Sector Sizes'] || info.Information['Sector Size']).split(' ');
  const blk: BlockDevice = {
    apiVersion: "cloudydeno.github.io/v1",
    kind: "BlockDevice",
    metadata: {
      name: `blk-${info.Information['Serial Number'].toLowerCase()}`,
      labels: {
        'cloudydeno.com/node': nodeName,
        'cloudydeno.com/blk-type': isSpinningDisk ? 'HDD' : 'SSD',
      },
      resourceVersion: knownDevSerials.get(info.Information['Serial Number']),
    },
    spec: {
      nodeName: nodeName,
      deviceModel: info.Information['Device Model'],
      devicePath: info.Device.path,
      formFactor: info.Information['Form Factor'],
      logicalSectorSize: parseInt(sectorSizeWords[0], 10),
      physicalSectorSize: parseInt(sectorSizeWords[3] || sectorSizeWords[0], 10),
      rotationRate: isSpinningDisk ? parseInt(info.Information['Rotation Rate'], 10) : 'SSD',
      serialNumber: info.Information['Serial Number'],
      userCapacity: parseInt(info.Information['User Capacity'].split(' ')[0].replace(/,/g, ''), 10),
      userCapacityHuman: info.Information['User Capacity'].split('[')[1]?.slice(0, -1),
    },
    status: {
      sataStatus: info.Information['SATA Version'],
      smartEnabled: info.Information['SMART support'] === 'Enabled',
      smartReport: {
        collectionTime: info.CollectionTime,
        overallAssessment: info.SelfAssessment,
        attributes: info.Attributes.map(attr => ({
          id: parseInt(attr['ID#'], 10),
          name: attr.ATTRIBUTE_NAME,
          currentHealth: parseInt(attr.VALUE, 10),
          worstHealth: parseInt(attr.WORST, 10),
          threshold: parseInt(attr.THRESH, 10),
          type: attr.TYPE,
          rawValue: attr.RAW_VALUE,
        })),
        errors: info.ErrorLog,
      },
    },
  };
  // console.log(blk.status);

  if (blk.metadata?.resourceVersion) {
    await petApi.replaceBlockDevice(blk.metadata?.name ?? '', blk);
    knownDevSerials.delete(blk.spec.serialNumber);
    console.log('Updated', blk.metadata.name);
  } else {
    await petApi.createBlockDevice(blk);
    console.log('Created', blk.metadata?.name);
  }
}

const leftoverDevs = Array.from(knownDevSerials.keys());
console.log('Leftover devices:', leftoverDevs);
for (const leftoverDev of leftoverDevs) {
  await petApi.deleteBlockDevice(`blk-${leftoverDev?.toLowerCase()}`, {});
}
