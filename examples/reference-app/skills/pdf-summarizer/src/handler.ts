import { DefaultAzureCredential } from '@azure/identity';
import { BlobServiceClient } from '@azure/storage-blob';
import { z } from 'zod';

/**
 * pdf-summarizer skill.
 *
 * Skill contract:
 *   input  → { documentUrl: string }   // blob URL inside the workspace storage
 *   output → { summary: string, pageCount: number, language: string }
 *
 * Real production handler would:
 *   1. Download the PDF from the workspace blob
 *   2. Submit to Azure AI Document Intelligence for layout extraction
 *   3. Call an LLM to summarize the extracted text
 *
 * This reference is intentionally a stub — operators replace `summarize`
 * with the real Document Intelligence + LLM pipeline. The Zod schemas +
 * Workload Identity wiring are real.
 */

export const InputSchema = z.object({
  documentUrl: z
    .string()
    .url()
    .refine((u) => u.endsWith('.pdf'), { message: 'must be a .pdf URL' }),
});

export const OutputSchema = z.object({
  summary: z.string().min(1).max(2000),
  pageCount: z.number().int().nonnegative(),
  language: z.string().length(2),
});

export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;

const fetchBlob = async (url: string): Promise<Uint8Array> => {
  // The URL must be a blob URL we have Workload Identity access to.
  const match = url.match(/^https:\/\/([^.]+)\.blob\.core\.windows\.net\/([^/]+)\/(.+)$/);
  if (match === null) {
    throw new Error(`URL must be a workspace blob URL: ${url}`);
  }
  const [, account, container, blobPath] = match;
  const service = new BlobServiceClient(
    `https://${account}.blob.core.windows.net`,
    new DefaultAzureCredential(),
  );
  const blob = service.getContainerClient(container ?? '').getBlockBlobClient(blobPath ?? '');
  const buf = await blob.downloadToBuffer();
  return new Uint8Array(buf);
};

// Stub summarizer — replace with a real Document Intelligence + LLM pipeline.
const summarize = (bytes: Uint8Array): Output => {
  const stubText = `Summary of a ${bytes.byteLength}-byte PDF document.`;
  return {
    summary: stubText,
    pageCount: 1,
    language: 'en',
  };
};

export const handler = async (rawInput: unknown): Promise<Output> => {
  const input = InputSchema.parse(rawInput);
  const bytes = await fetchBlob(input.documentUrl);
  const output = summarize(bytes);
  return OutputSchema.parse(output);
};
