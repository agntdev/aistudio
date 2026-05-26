import { NextRequest, NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const REGION = process.env.S3_REGION || 'us-east-1';
const BUCKET = process.env.S3_BUCKET || 'aistudio-training-datasets';
const ENDPOINT = process.env.S3_ENDPOINT;
const EXPIRES_IN_SECONDS = 60 * 60;

function buildClient():
  | { ok: true; client: S3Client }
  | { ok: false; error: string } {
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    return {
      ok: false,
      error:
        'S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be set in the environment. See .env.example.',
    };
  }
  return {
    ok: true,
    client: new S3Client({
      region: REGION,
      endpoint: ENDPOINT,
      forcePathStyle: !!ENDPOINT,
      credentials: { accessKeyId, secretAccessKey },
    }),
  };
}

interface FileMeta {
  name: string;
  size: number;
  type: string;
}

async function signOne(client: S3Client, key: string, contentType: string) {
  const cmd = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(client, cmd, { expiresIn: EXPIRES_IN_SECONDS });
}

export async function POST(req: NextRequest) {
  try {
    const built = buildClient();
    if (!built.ok) {
      return NextResponse.json(
        { error: 'S3 not configured', detail: built.error },
        { status: 500 }
      );
    }
    const s3 = built.client;

    const body = await req.json();
    const { files, zipName } = body as {
      files?: FileMeta[];
      zipName?: string;
    };

    if ((!files || !Array.isArray(files) || files.length === 0) && !zipName) {
      return NextResponse.json(
        { error: 'files[] or zipName required' },
        { status: 400 }
      );
    }

    const prefix = `training-datasets/${Date.now()}`;
    const uploads: Array<{
      fileName: string;
      key: string;
      url: string;
      expiresIn: number;
    }> = [];

    if (files && files.length > 0) {
      await Promise.all(
        files.map(async (f) => {
          const safeName = f.name.replace(/[^a-zA-Z0-9._-]/g, '_');
          const key = `${prefix}/${safeName}`;
          const url = await signOne(s3, key, f.type || 'application/octet-stream');
          uploads.push({
            fileName: f.name,
            key,
            url,
            expiresIn: EXPIRES_IN_SECONDS,
          });
        })
      );
    }

    if (zipName) {
      const safeName = zipName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const key = `${prefix}/${safeName}`;
      const url = await signOne(s3, key, 'application/zip');
      uploads.push({ fileName: zipName, key, url, expiresIn: EXPIRES_IN_SECONDS });
    }

    return NextResponse.json({
      success: true,
      bucket: BUCKET,
      region: REGION,
      uploads,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown';
    console.error('presigned error', err);
    return NextResponse.json(
      { error: 'Failed to generate presigned URLs', detail: message },
      { status: 500 }
    );
  }
}
