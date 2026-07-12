import type { UploadResult, UploadTag, Uploader } from '../src/adapters/types.js';
import type { MockGatewayItem } from './mock-gateway.js';

export interface MockUploaderRecord {
  tags: UploadTag[];
  data: Uint8Array;
  id: string;
  uri: string;
  height: number;
}

export interface MockUploader extends Uploader {
  readonly records: MockUploaderRecord[];
}

export function createMockUploader(): MockUploader {
  const records: MockUploaderRecord[] = [];
  let counter = 0;

  return {
    records,
    async upload(data: Uint8Array, tags: UploadTag[]): Promise<UploadResult> {
      counter += 1;
      const id = `mock-${String(counter)}`;
      const record: MockUploaderRecord = {
        tags: [...tags],
        data,
        id,
        uri: `ar://${id}`,
        height: counter,
      };
      records.push(record);
      return { id, uri: record.uri };
    },
  };
}

function tagValue(tags: UploadTag[], name: string): string | undefined {
  return tags.find((tag) => tag.name === name)?.value;
}

/** Bridge mock uploader leaf uploads into tag-query gateway items. */
export function uploaderStoreToGatewayItems(
  records: readonly MockUploaderRecord[],
  publisher: string,
  epoch: number,
): MockGatewayItem[] {
  const items: MockGatewayItem[] = [];

  for (const record of records) {
    const leafKey = tagValue(record.tags, 'LeafKey');
    const recordEpoch = tagValue(record.tags, 'Epoch');
    const app = tagValue(record.tags, 'App');
    if (leafKey === undefined || recordEpoch !== String(epoch) || app !== 'vincent') {
      continue;
    }

    const payload = JSON.parse(new TextDecoder().decode(record.data)) as {
      leaf: string;
      proof: MockGatewayItem['data']['proof'];
    };

    items.push({
      owner: publisher,
      epoch,
      leafKey,
      txId: record.id,
      height: record.height,
      data: { leaf: payload.leaf, proof: payload.proof },
    });
  }

  return items;
}
