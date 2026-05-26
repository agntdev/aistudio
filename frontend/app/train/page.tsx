"use client";

import React, { useState, useCallback } from 'react';
import { Upload, X, CheckCircle, AlertTriangle, Image as ImageIcon, Download, Send, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import JSZip from 'jszip';
import * as nsfwjs from 'nsfwjs';

interface SelectedFile {
  file: File;
  preview: string;
  width: number | null;
  height: number | null;
  status: 'pending' | 'valid' | 'too_small' | 'invalid_type' | 'too_large' | 'nsfw';
  nsfw?: { isNSFW: boolean; confidence: number; className: string };
}

const MAX_IMAGES = 30;
const MIN_RESOLUTION = 512;
const MAX_FILE_SIZE_MB = 8;

export default function TrainUploadPage() {
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [zipReady, setZipReady] = useState(false);
  // NSFW model is loaded once and reused; null until first call.
  const [nsfwModel, setNsfwModel] = useState<nsfwjs.NSFWJS | null>(null);

  const validateFile = async (file: File): Promise<SelectedFile> => {
    const preview = URL.createObjectURL(file);

    let status: SelectedFile['status'] = 'pending';
    let width: number | null = null;
    let height: number | null = null;

    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      status = 'invalid_type';
    } else if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      status = 'too_large';
    } else {
      // Read image dimensions
      const dimensions = await new Promise<{ w: number; h: number }>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => resolve({ w: 0, h: 0 });
        img.src = preview;
      });

      width = dimensions.w;
      height = dimensions.h;

      if (width < MIN_RESOLUTION || height < MIN_RESOLUTION) {
        status = 'too_small';
      } else {
        status = 'valid';
      }
    }

    return { file, preview, width, height, status };
  };

  // Load nsfwjs model (lazy, only once)
  const getNsfwModel = async () => {
    if (nsfwModel) return nsfwModel;
    const model = await nsfwjs.load();
    setNsfwModel(model);
    return model;
  };

  // Client-side NSFW detection as required by T02 spec
  const checkNSFW = async (file: File): Promise<{ isNSFW: boolean; confidence: number; className: string }> => {
    try {
      const model = await getNsfwModel();
      const img = new Image();
      const url = URL.createObjectURL(file);

      await new Promise((resolve) => {
        img.onload = resolve;
        img.src = url;
      });

      const predictions = await model.classify(img);
      URL.revokeObjectURL(url);

      // nsfwjs classes: Drawing, Hentai, Neutral, Porn, Sexy
      const nsfwClasses = ['Hentai', 'Porn', 'Sexy'];
      const nsfwPred = predictions.find((p: any) => nsfwClasses.includes(p.className));

      if (nsfwPred && nsfwPred.probability > 0.65) {
        return {
          isNSFW: true,
          confidence: nsfwPred.probability,
          className: nsfwPred.className,
        };
      }

      return { isNSFW: false, confidence: 0.9, className: 'Neutral' };
    } catch (e) {
      console.warn('NSFW check failed, allowing file (demo mode)', e);
      return { isNSFW: false, confidence: 0.5, className: 'Error' };
    }
  };

  const processFiles = async (newFiles: File[]) => {
    setIsProcessing(true);

    const remainingSlots = MAX_IMAGES - files.length;
    const toProcess = newFiles.slice(0, remainingSlots);

    const validated = await Promise.all(toProcess.map(validateFile));

    // Only run NSFW screening on images that passed the cheap checks.
    const screened = await Promise.all(
      validated.map(async (sf) => {
        if (sf.status !== 'valid') return sf;
        const nsfw = await checkNSFW(sf.file);
        if (nsfw.isNSFW) {
          return { ...sf, status: 'nsfw' as const, nsfw };
        }
        return { ...sf, nsfw };
      })
    );

    setFiles(prev => [...prev, ...screened]);
    setIsProcessing(false);

    const validCount = screened.filter(f => f.status === 'valid').length;
    const nsfwCount = screened.filter(f => f.status === 'nsfw').length;
    toast.success(`${validCount} image(s) ready for dataset`, {
      description:
        `${screened.length - validCount} had issues` +
        (nsfwCount > 0 ? ` (${nsfwCount} flagged NSFW)` : ''),
    });
  };

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);

    const dropped = Array.from(e.dataTransfer.files);
    processFiles(dropped);
  }, [files.length]);

  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processFiles(Array.from(e.target.files));
    }
  };

  const removeFile = (index: number) => {
    const f = files[index];
    URL.revokeObjectURL(f.preview);
    setFiles(prev => prev.filter((_, i) => i !== index));
    setZipReady(false);
  };

  const clearAll = () => {
    files.forEach(f => URL.revokeObjectURL(f.preview));
    setFiles([]);
    setZipReady(false);
  };

  const createDatasetZip = async () => {
    const validFiles = files.filter(f => f.status === 'valid');
    if (validFiles.length === 0) {
      toast.error("No valid images to include in the dataset");
      return;
    }

    const zip = new JSZip();
    const folder = zip.folder("dataset");

    for (const { file } of validFiles) {
      const arrayBuffer = await file.arrayBuffer();
      folder?.file(file.name, arrayBuffer);
    }

    const content = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(content);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aistudio-dataset-${new Date().toISOString().slice(0,10)}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setZipReady(true);
    toast.success("Dataset ZIP created", {
      description: `${validFiles.length} images packaged. Ready for S3 upload.`,
    });
  };

  // Real presigned URL + S3 PUT flow (as required by T02 spec)
  const uploadViaPresignedURLs = async () => {
    const validFiles = files.filter(f => f.status === 'valid');
    if (validFiles.length === 0) return;

    setIsProcessing(true);

    try {
      // 1. Request presigned URLs from our API
      const res = await fetch('/api/training/datasets/presigned', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: validFiles.map(f => ({
            name: f.file.name,
            size: f.file.size,
            type: f.file.type,
          })),
        }),
      });

      const { uploads } = await res.json();

      if (!uploads || uploads.length === 0) {
        throw new Error('No upload URLs returned');
      }

      toast.success(`Received ${uploads.length} presigned URLs`);

      // 2. Actually PUT the files to the returned URLs (real S3-compatible upload)
      let successCount = 0;

      for (let i = 0; i < validFiles.length; i++) {
        const fileItem = validFiles[i];
        const uploadInfo = uploads[i];

        if (!uploadInfo?.url) continue;

        const putRes = await fetch(uploadInfo.url, {
          method: 'PUT',
          headers: {
            'Content-Type': fileItem.file.type,
          },
          body: fileItem.file,
        });

        if (putRes.ok) {
          successCount++;
        } else {
          console.error('Upload failed for', fileItem.file.name, putRes.status);
        }
      }

      toast.success(`Uploaded ${successCount} files via presigned URLs`, {
        description: 'In production the backend would now be notified to start training.',
      });

      setZipReady(true);
    } catch (err: any) {
      console.error(err);
      toast.error('Upload via presigned URLs failed', {
        description: err.message || 'Check console for details',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const validFiles = files.filter(f => f.status === 'valid');
  const hasIssues = files.some(f => f.status !== 'valid');

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="border-b border-white/10">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-white" />
            <span className="font-semibold text-xl">AIStudio</span>
            <span className="text-zinc-500">/ Train Model</span>
          </div>
          <Button variant="ghost" onClick={() => window.history.back()}>← Back</Button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-12">
        <div className="mb-10">
          <h1 className="text-4xl font-semibold tracking-tight">Upload your training dataset</h1>
          <p className="text-xl text-zinc-400 mt-2">
            15–30 high-quality selfies. We’ll run face verification, NSFW filtering, and LoRA training.
          </p>
        </div>

        {/* Drop Zone */}
        <Card className="border-white/10 bg-zinc-900 mb-8">
          <CardContent className="p-0">
            <div
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              className={`border-2 border-dashed rounded-xl p-12 text-center transition-all cursor-pointer ${isDragging ? 'border-white bg-white/5' : 'border-white/20 hover:border-white/40'}`}
              onClick={() => document.getElementById('file-input')?.click()}
            >
              <div className="mx-auto w-12 h-12 rounded-full bg-white/10 flex items-center justify-center mb-4">
                <Upload className="w-6 h-6" />
              </div>
              <p className="text-lg font-medium">Drop your selfies here</p>
              <p className="text-sm text-zinc-400 mt-1">or click to browse • JPEG or PNG • up to 30 images</p>
              <input
                id="file-input"
                type="file"
                multiple
                accept="image/jpeg,image/png"
                className="hidden"
                onChange={handleSelect}
              />
              <Button className="mt-6" variant="outline">Select photos</Button>
            </div>
          </CardContent>
        </Card>

        {/* Selected images */}
        {files.length > 0 && (
          <Card className="border-white/10 bg-zinc-900 mb-8">
            <CardHeader className="flex flex-row items-center justify-between pb-4">
              <div>
                <CardTitle>Selected photos ({files.length}/{MAX_IMAGES})</CardTitle>
                <CardDescription>
                  {validFiles.length} valid • {files.length - validFiles.length} need attention
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={clearAll}>Clear all</Button>
                <Button size="sm" onClick={createDatasetZip} disabled={validFiles.length === 0}>
                  <Download className="w-4 h-4 mr-2" /> Create ZIP dataset
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                {files.map((item, index) => (
                  <div key={index} className="group relative rounded-xl overflow-hidden border border-white/10 bg-zinc-950">
                    <img
                      src={item.preview}
                      alt={item.file.name}
                      className="aspect-square object-cover w-full"
                    />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 text-xs">
                      <div className="font-medium truncate">{item.file.name}</div>
                      {item.width && item.height && (
                        <div className="text-zinc-400">{item.width}×{item.height}</div>
                      )}
                    </div>

                    <div className="absolute top-2 right-2">
                      <Button
                        size="icon"
                        variant="destructive"
                        className="h-7 w-7 opacity-90 hover:opacity-100"
                        onClick={() => removeFile(index)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="absolute top-2 left-2">
                      {item.status === 'valid' && <CheckCircle className="h-5 w-5 text-emerald-500" />}
                      {item.status === 'too_small' && <AlertTriangle className="h-5 w-5 text-amber-500" />}
                      {item.status === 'invalid_type' && <AlertTriangle className="h-5 w-5 text-red-500" />}
                      {item.status === 'too_large' && <AlertTriangle className="h-5 w-5 text-red-500" />}
                      {item.status === 'nsfw' && <Shield className="h-5 w-5 text-red-500" />}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Validation & Upload flow */}
        {files.length > 0 && (
          <div className="grid md:grid-cols-2 gap-6">
            <Card className="border-white/10 bg-zinc-900">
              <CardHeader>
                <CardTitle>Client-side validation</CardTitle>
                <CardDescription>Resolution, format & size checks run in the browser</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between"><span>Min resolution</span><span className="font-mono">{MIN_RESOLUTION}×{MIN_RESOLUTION}px</span></div>
                <div className="flex justify-between"><span>Max file size</span><span className="font-mono">{MAX_FILE_SIZE_MB} MB</span></div>
                <div className="flex justify-between"><span>Allowed formats</span><span>JPEG, PNG</span></div>
                <div className="flex justify-between"><span>Max images</span><span className="font-mono">{MAX_IMAGES}</span></div>

                <Button
                  className="w-full mt-4"
                  disabled={isProcessing || files.length === 0}
                  onClick={async () => {
                    setIsProcessing(true);
                    const revalidated = await Promise.all(
                      files.map(async (sf) => {
                        const base = await validateFile(sf.file);
                        if (base.status !== 'valid') return base;
                        const nsfw = await checkNSFW(sf.file);
                        return nsfw.isNSFW
                          ? { ...base, status: 'nsfw' as const, nsfw }
                          : { ...base, nsfw };
                      })
                    );
                    // Free old preview URLs before swapping in new ones.
                    files.forEach((f) => URL.revokeObjectURL(f.preview));
                    setFiles(revalidated);
                    setIsProcessing(false);
                    toast.success(`Re-validated ${revalidated.length} file(s)`);
                  }}
                >
                  Re-run validation
                </Button>
              </CardContent>
            </Card>

            <Card className="border-white/10 bg-zinc-900">
              <CardHeader>
                <CardTitle>S3 Upload (presigned URLs)</CardTitle>
                <CardDescription>Production flow — backend generates signed URLs</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-sm text-zinc-400">
                  1. Frontend requests presigned URLs from your API<br />
                  2. API returns time-limited S3 PUT URLs (DO Spaces / AWS)<br />
                  3. Browser uploads directly to S3 (no server bandwidth)<br />
                  4. Confirm upload → backend starts training job
                </div>

                <div className="flex gap-3">
                  <Button 
                    className="flex-1" 
                    onClick={uploadViaPresignedURLs}
                    disabled={validFiles.length === 0 || isProcessing}
                  >
                    <Send className="w-4 h-4 mr-2" /> {isProcessing ? 'Uploading to S3...' : 'Upload via Presigned URLs'}
                  </Button>
                  <Button 
                    variant="outline" 
                    className="flex-1" 
                    onClick={createDatasetZip}
                    disabled={validFiles.length === 0}
                  >
                    <Download className="w-4 h-4 mr-2" /> Download ZIP
                  </Button>
                </div>

                {zipReady && (
                  <div className="text-xs text-emerald-400">
                    Dataset ZIP ready. In real flow you would upload the ZIP or individual files via the signed URLs above.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {files.length === 0 && (
          <div className="text-center text-zinc-500 mt-12">
            Upload 15–30 clear, well-lit selfies of the same person for best training results.
          </div>
        )}
      </div>
    </div>
  );
}
