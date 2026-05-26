import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/training/datasets/presigned
 *
 * Accepts a list of files (or a single dataset ZIP) and returns
 * presigned S3/DO Spaces PUT URLs.
 *
 * In production this would:
 * - Authenticate the user (Clerk)
 * - Generate real time-limited presigned URLs via AWS SDK / DigitalOcean Spaces
 * - Store metadata in the DB for later confirmation
 *
 * For the T02 bounty task, we return realistic-looking presigned URLs
 * so the frontend can demonstrate the full "get URLs → PUT files" flow.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Expected body shapes:
    // { files: [{ name: string, size: number, type: string }], ... }
    // or { zipName: string, size: number }
    const { files, zipName, size } = body;

    if (!files && !zipName) {
      return NextResponse.json({ error: 'files or zipName required' }, { status: 400 });
    }

    const uploads: any[] = [];

    if (files && Array.isArray(files)) {
      for (const f of files) {
        // In real life: s3.getSignedUrl('putObject', { Key: `datasets/${userId}/${f.name}`, ... })
        const key = `training-datasets/${Date.now()}-${f.name}`;
        uploads.push({
          fileName: f.name,
          key,
          url: `https://agnt-gm.ams3.digitaloceanspaces.com/${key}?X-Amz-Algorithm=...&X-Amz-Expires=3600&...`,
          expiresIn: 3600,
        });
      }
    } else if (zipName) {
      const key = `training-datasets/${Date.now()}-${zipName}`;
      uploads.push({
        fileName: zipName,
        key,
        url: `https://agnt-gm.ams3.digitaloceanspaces.com/${key}?X-Amz-Algorithm=...&X-Amz-Expires=3600&...`,
        expiresIn: 3600,
      });
    }

    return NextResponse.json({
      success: true,
      uploads,
      // In a real system we would also return an uploadSessionId
      // that the client uses when confirming the upload later.
    });
  } catch (err: any) {
    console.error('presigned error', err);
    return NextResponse.json({ error: 'Failed to generate presigned URLs' }, { status: 500 });
  }
}
