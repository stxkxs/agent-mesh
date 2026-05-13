import { ConfigurationError } from '@agent-mesh/core/errors';
import { AppConfigurationClient } from '@azure/app-configuration';
import { DefaultAzureCredential } from '@azure/identity';
import { BlobServiceClient } from '@azure/storage-blob';

import type { PromptId } from '@agent-mesh/core/ids';
import type { TokenCredential } from '@azure/identity';

/**
 * Prompts are stored as content-addressed Blob assets and resolved through
 * an App Configuration pointer:
 *
 *   App Configuration key: agent-mesh/prompts/<promptId>/current
 *   value: { "url": "https://<sa>.blob.core.windows.net/prompts/<id>/<sha256>.mdx", "sha256": "..." }
 *
 * Promotion across environments is a pointer swap — no Blob rewrite, no
 * agent restart.
 *
 * The resolver caches per-process. A pointer change requires an agent
 * restart (or wiring an App Configuration sentinel + polling — left as
 * an operator decision; out of scope for this module).
 */

export interface PromptResolverOptions {
  /** App Configuration endpoint, e.g. `https://appcs-platform-prod.azconfig.io`. */
  readonly appConfigEndpoint: string;
  /** Blob Storage service URL, e.g. `https://<sa>.blob.core.windows.net`. */
  readonly blobServiceUrl: string;
  /** Container name where prompt artifacts live. Default `prompts`. */
  readonly container?: string;
  /** Override the credential chain (test-only). */
  readonly credential?: TokenCredential;
}

export interface ResolvedPrompt {
  readonly id: PromptId;
  readonly content: string;
  readonly sha256: string;
  readonly url: string;
}

interface PointerValue {
  readonly url: string;
  readonly sha256: string;
}

export class PromptResolver {
  private readonly appConfig: AppConfigurationClient;
  private readonly blobs: BlobServiceClient;
  private readonly container: string;
  private readonly cache = new Map<string, ResolvedPrompt>();

  public constructor(opts: PromptResolverOptions) {
    const cred = opts.credential ?? new DefaultAzureCredential();
    this.appConfig = new AppConfigurationClient(opts.appConfigEndpoint, cred);
    this.blobs = new BlobServiceClient(opts.blobServiceUrl, cred);
    this.container = opts.container ?? 'prompts';
  }

  public async resolve(promptId: PromptId): Promise<ResolvedPrompt> {
    const cached = this.cache.get(promptId);
    if (cached !== undefined) return cached;

    const pointerKey = `agent-mesh/prompts/${promptId}/current`;
    const setting = await this.appConfig.getConfigurationSetting({ key: pointerKey });
    if (setting.value === undefined) {
      throw new ConfigurationError(`No App Configuration pointer at ${pointerKey}`, { promptId });
    }

    let pointer: PointerValue;
    try {
      pointer = JSON.parse(setting.value) as PointerValue;
    } catch {
      throw new ConfigurationError(`Pointer value at ${pointerKey} is not JSON`, {
        promptId,
        value: setting.value,
      });
    }

    const containerClient = this.blobs.getContainerClient(this.container);
    const blobName = this.parseBlobName(pointer.url);
    const blob = containerClient.getBlobClient(blobName);
    const download = await blob.download();
    if (download.readableStreamBody === undefined) {
      throw new ConfigurationError(`Blob ${blobName} has no body`, { promptId });
    }
    const content = await this.streamToString(download.readableStreamBody);

    const resolved: ResolvedPrompt = {
      id: promptId,
      content,
      sha256: pointer.sha256,
      url: pointer.url,
    };
    this.cache.set(promptId, resolved);
    return resolved;
  }

  private parseBlobName(url: string): string {
    const match = url.match(new RegExp(`/${this.container}/(.+)$`));
    if (match === null || match[1] === undefined) {
      throw new ConfigurationError(`Pointer URL ${url} does not match container ${this.container}`);
    }
    return match[1];
  }

  private async streamToString(
    stream: NodeJS.ReadableStream | ReadableStream<unknown>,
  ): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream as NodeJS.ReadableStream) {
      if (Buffer.isBuffer(chunk)) {
        chunks.push(chunk);
      } else if (typeof chunk === 'string') {
        chunks.push(Buffer.from(chunk, 'utf8'));
      } else {
        chunks.push(Buffer.from(chunk as Uint8Array));
      }
    }
    return Buffer.concat(chunks).toString('utf8');
  }
}
