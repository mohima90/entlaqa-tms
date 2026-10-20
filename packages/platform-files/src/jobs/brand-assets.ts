import {
  type BrandAssetWork,
  type SystemTx,
  type WithPlatformTx,
  type WithSystemTx,
  claimBrandAssetWork,
  publishBrandAsset,
} from '@jadarat/platform-db/jobs';
import type { PlatformTask, WorkerLogLevel } from '@jadarat/platform-jobs/jobs';
import { brandImageMaxBytes, checkBrandImageContent } from '../brand-images';
import { codeOf, isTemporary } from './store';
import type { WorkerFiles } from './worker-files';

/**
 * Publishing branding images (WP-ADM-02, FR-ADM-07; docs/engineering/branding.md): a platform task that,
 * each pass, finds the images an organization's Branding uses which the malware scan found clean and which
 * have no public copy yet (private.claim_brand_asset_work), reads each scanned file — its stream checks the
 * size and SHA-256 the scan recorded —, checks its type by content once more (PNG, JPEG or WebP only), and
 * stores the copy in the image's tenant transaction (private.publish_brand_asset, which checks the bytes
 * against the scan again and that the Branding still uses the image). The sign-in page, the browser tab and
 * e-mails then show it from /api/brand/<id>. A failure leaves the image unpublished (the Jadarat image is
 * shown) and is tried again on the next pass; logs carry ids and codes only.
 */
export const BRAND_ASSET_TASK = 'platform.brand_assets';
/** Images per pass. */
export const BRAND_ASSET_BATCH = 20;

export interface BrandAssetTaskOptions {
  readonly withPlatformTx: WithPlatformTx;
  readonly withSystemTx: WithSystemTx;
  readonly files: WorkerFiles;
  readonly log: (level: WorkerLogLevel, message: string) => void;
}

async function readAll(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw Object.assign(new Error('branding image larger than its purpose allows'), {
        code: 'TOO_LARGE',
      });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

export function createBrandAssetTask(options: BrandAssetTaskOptions): PlatformTask {
  const { withPlatformTx, withSystemTx, files, log } = options;

  async function publish(jobId: string, work: BrandAssetWork): Promise<'published' | 'skipped'> {
    return withSystemTx({ tenantId: work.tenantId, jobId }, async (tx: SystemTx) => {
      const stream = await files.openScannedFile(tx, work.fileId);
      const bytes = await readAll(stream, brandImageMaxBytes(work.kind));
      const checked = await checkBrandImageContent(work.kind, bytes);
      if ('refused' in checked) {
        log('warning', `branding image ${work.fileId} not published: ${checked.refused}`);
        return 'skipped';
      }
      const id = await publishBrandAsset(tx, work, bytes);
      return id === null ? 'skipped' : 'published';
    });
  }

  return {
    name: BRAND_ASSET_TASK,
    async run({ jobId }) {
      const due = await withPlatformTx({ jobId }, (tx) =>
        claimBrandAssetWork(tx, BRAND_ASSET_BATCH),
      );
      let published = 0;
      for (const work of due) {
        try {
          if ((await publish(jobId, work)) === 'published') published += 1;
        } catch (error) {
          // Storage unavailable: stop this pass, the next one tries again.
          if (isTemporary(error)) {
            log('warning', `branding images: storage unavailable (${codeOf(error)}); later`);
            return false;
          }
          log('error', `branding image ${work.fileId} not published: ${codeOf(error)}`);
        }
      }
      if (published > 0) log('info', `branding images published: ${published}`);
      return false;
    },
  };
}
