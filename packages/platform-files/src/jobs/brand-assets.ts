import { createHash } from 'node:crypto';
import {
  type BrandAssetWork,
  type SystemTx,
  type WithPlatformTx,
  type WithSystemTx,
  claimBrandAssetWork,
  loadBrandImageSource,
  noteBrandAssetFailure,
  publishBrandAsset,
  publishBrandImage,
} from '@jadarat/platform-db/jobs';
import type { PlatformTask, WorkerLogLevel } from '@jadarat/platform-jobs/jobs';
import { brandImageMaxBytes, prepareBrandImage } from '../brand-images';
import { prepareBrandUpload } from '../brand-prepare';
import { type FileObjectStore, codeOf, isTemporary } from './store';
import type { WorkerFiles } from './worker-files';

/**
 * Publishing branding images (WP-ADM-02, FR-ADM-07; docs/engineering/branding.md): a platform task that,
 * each pass, finds the images an organization's Branding uses which the malware scan found clean and which
 * have no public copy yet (private.claim_brand_asset_work), reads each scanned file — its stream checks the
 * size and SHA-256 the scan recorded —, checks its type by content once more (PNG, JPEG or WebP only) and its
 * size in pixels (4096 px, the browser icon 512 px), removes its metadata (EXIF with GPS, XMP, IPTC,
 * comments; image-info.ts) and stores that copy in the image's tenant transaction
 * (private.publish_brand_asset, which checks the source hash against the scan again and that the Branding
 * still uses the image). The sign-in page, the browser tab and e-mails then show it from /api/brand/<id>.
 * A failure leaves the image unpublished (the Jadarat image is shown): Storage being unavailable ends the
 * pass (tried again next pass); any other failure is recorded (private.note_brand_asset_failure) and tried
 * again after 2, 4, 8, … minutes, up to 5 times — then the image is given up and the Branding page says it
 * cannot be used. Logs carry ids and codes only.
 *
 * Since 20 Oct 2026 (PO: branding images are not virus-scanned, like Kawadir) the web app publishes the
 * images when the Branding is saved; this task is the FALLBACK for an image it did not publish (Storage
 * unreachable then, an upload saved before the change): an image in use of a purpose without a scan that
 * is `uploaded` or `accepted` is read from Storage with the worker's key, prepared exactly as the web app
 * does (prepareBrandUpload) and published with private.publish_brand_image (the database compares the
 * bytes read with the stored object). Clean images keep the path above.
 */
export const BRAND_ASSET_TASK = 'platform.brand_assets';
/** Images per pass. */
export const BRAND_ASSET_BATCH = 20;

export interface BrandAssetTaskOptions {
  readonly withPlatformTx: WithPlatformTx;
  readonly withSystemTx: WithSystemTx;
  readonly files: WorkerFiles;
  /** The worker's Storage access: images of a purpose without a scan are read directly (never `clean`). */
  readonly store: FileObjectStore;
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
  const { withPlatformTx, withSystemTx, files, store, log } = options;

  /** An image of a purpose without a malware scan, `uploaded` or `accepted` (the web app's fallback). */
  async function publishUnscanned(
    tx: SystemTx,
    work: BrandAssetWork,
    source: { readonly bucket: string; readonly objectKey: string },
  ): Promise<'published' | 'skipped'> {
    const object = await store.read(source.bucket, source.objectKey);
    if (!object) {
      throw Object.assign(new Error('branding image object missing'), { code: 'OBJECT_MISSING' });
    }
    const bytes = await readAll(object.body, brandImageMaxBytes(work.kind));
    const prepared = await prepareBrandUpload(work.kind, work.fileId, bytes);
    if ('refused' in prepared) {
      const attempts = await noteBrandAssetFailure(tx, work.fileId, prepared.refused);
      log(
        'warning',
        `branding image ${work.fileId} not published: ${prepared.refused} (attempt ${attempts})`,
      );
      return 'skipped';
    }
    const image = prepared.prepared;
    const id = await publishBrandImage(tx, {
      fileId: work.fileId,
      kind: work.kind,
      sourceSha256: image.sourceSha256,
      sourceSize: image.sourceSize,
      contentType: image.contentType,
      content: image.content,
    });
    return id === null ? 'skipped' : 'published';
  }

  async function publish(jobId: string, work: BrandAssetWork): Promise<'published' | 'skipped'> {
    return withSystemTx({ tenantId: work.tenantId, jobId }, async (tx: SystemTx) => {
      const source = await loadBrandImageSource(tx, work.fileId);
      if (!source) return 'skipped';
      if (source.status !== 'clean') {
        if (source.scanRequired || !['uploaded', 'accepted'].includes(source.status)) {
          return 'skipped';
        }
        return publishUnscanned(tx, work, source);
      }
      const stream = await files.openScannedFile(tx, work.fileId);
      const bytes = await readAll(stream, brandImageMaxBytes(work.kind));
      const prepared = await prepareBrandImage(work.kind, bytes);
      if ('refused' in prepared) {
        const attempts = await noteBrandAssetFailure(tx, work.fileId, prepared.refused);
        log(
          'warning',
          `branding image ${work.fileId} not published: ${prepared.refused} (attempt ${attempts})`,
        );
        return 'skipped';
      }
      const sourceSha256 = createHash('sha256').update(bytes).digest('hex');
      const id = await publishBrandAsset(tx, work, sourceSha256, prepared.content);
      return id === null ? 'skipped' : 'published';
    });
  }

  /** Records a failure in its own transaction (the publishing one was rolled back). */
  async function noteFailure(jobId: string, work: BrandAssetWork, code: string): Promise<void> {
    try {
      const attempts = await withSystemTx({ tenantId: work.tenantId, jobId }, (tx) =>
        noteBrandAssetFailure(tx, work.fileId, code),
      );
      log('error', `branding image ${work.fileId} not published: ${code} (attempt ${attempts})`);
    } catch (error) {
      log(
        'error',
        `branding image ${work.fileId} not published: ${code}; not recorded (${codeOf(error)})`,
      );
    }
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
          await noteFailure(jobId, work, codeOf(error));
        }
      }
      if (published > 0) log('info', `branding images published: ${published}`);
      return false;
    },
  };
}
