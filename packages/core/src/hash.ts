import { createHash } from 'node:crypto';

/**
 * SHA-256 of a UTF-8 string. Used to mint content-addressed prompt IDs
 * and skill bundle fingerprints — identical content always produces the
 * same hash, so promotion across environments is a pure pointer swap.
 */
export const sha256 = (input: string): string =>
  createHash('sha256').update(input, 'utf8').digest('hex');

/**
 * SHA-256 of a Buffer / Uint8Array. Used to hash binary skill bundles
 * (.tar.gz) and Blob-stored model artifacts.
 */
export const sha256Bytes = (input: Uint8Array): string =>
  createHash('sha256').update(input).digest('hex');

/**
 * Short content-addressed id — first 12 hex chars of SHA-256. Used for
 * human-readable bundle suffixes (`<name>/<version>-<fp12>.tar.gz`).
 * Birthday collision threshold is ~16M unique inputs, which is far above
 * any realistic skill catalog cardinality.
 */
export const shortHash = (input: string): string => sha256(input).slice(0, 12);
