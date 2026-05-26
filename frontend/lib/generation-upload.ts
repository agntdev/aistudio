/**
 * Persistence layer for processed generation buffers (T04).
 *
 * Production: writes to S3 / DO Spaces using the same env vars the T02
 * presigned-upload route relies on. Dev fallback (no S3 creds): returns
 * a `data:` URL so the gallery is fully exercisable locally.
 */

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const BUCKET = process.env.S3_BUCKET || 'aistudio-generations';
const REGION = process.env.S3_REGION || 'us-east-1';
const ENDPOINT = process.env.S3_ENDPOINT;
const PUBLIC_URL_BASE =
  process.env.S3_PUBLIC_URL_BASE ||
  (ENDPOINT ? `${ENDPOINT}/${BUCKET}` : `https://${BUCKET}.s3.${REGION}.amazonaws.com`);

function buildClient(): S3Client | null {
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) return null;
  return new S3Client({
    region: REGION,
    endpoint: ENDPOINT,
    forcePathStyle: !!ENDPOINT,
    credentials: { accessKeyId, secretAccessKey },
  });
}

export interface UploadedAssets {
  imageUrl: string;
  thumbnailUrl: string;
}

export async function uploadGenerationAssets(
  id: string,
  masterBuf: Buffer,
  thumbBuf: Buffer
): Promise<UploadedAssets> {
  const client = buildClient();

  if (!client) {
    // Dev fallback: data URLs let the gallery render without S3 creds.
    return {
      imageUrl: `data:image/jpeg;base64,${masterBuf.toString('base64')}`,
      thumbnailUrl: `data:image/jpeg;base64,${thumbBuf.toString('base64')}`,
    };
  }

  const masterKey = `generations/${id}.jpg`;
  const thumbKey = `generations/${id}_thumb.jpg`;

  await Promise.all([
    client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: masterKey,
        Body: masterBuf,
        ContentType: 'image/jpeg',
        CacheControl: 'public, max-age=31536000, immutable',
      })
    ),
    client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: thumbKey,
        Body: thumbBuf,
        ContentType: 'image/jpeg',
        CacheControl: 'public, max-age=31536000, immutable',
      })
    ),
  ]);

  return {
    imageUrl: `${PUBLIC_URL_BASE}/${masterKey}`,
    thumbnailUrl: `${PUBLIC_URL_BASE}/${thumbKey}`,
  };
}
