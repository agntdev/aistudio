'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Camera, CheckCircle, AlertCircle, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { performLivenessCheckOnVideo, type LivenessResult } from '@/lib/safety';

interface LivenessVerificationProps {
  onVerified: (result: LivenessResult) => void;
  requiredDuration?: number;
}

export function LivenessVerification({ onVerified, requiredDuration = 5 }: LivenessVerificationProps) {
  const [status, setStatus] = useState<'idle' | 'requesting' | 'recording' | 'processing' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LivenessResult | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startLivenessCheck = async () => {
    setStatus('requesting');
    setError(null);

    try {
      // Request camera access
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setStatus('recording');

      if (!videoRef.current) {
        throw new Error('Video element not ready');
      }

      // Real motion-based liveness check on the live video stream.
      const livenessResult = await performLivenessCheckOnVideo(videoRef.current, {
        durationSeconds: requiredDuration,
      });

      setResult(livenessResult);
      setStatus('processing');

      await new Promise((r) => setTimeout(r, 400));

      if (livenessResult.verified) {
        setStatus('success');
        onVerified(livenessResult);
      } else {
        const reason = livenessResult.metadata?.rejectionReason || 'not enough motion';
        throw new Error(`Liveness check failed: ${reason}`);
      }
    } catch (err: any) {
      console.error('Liveness error:', err);
      setError(err.message || 'Could not access camera or complete liveness check');
      setStatus('error');
    } finally {
      // Clean up camera
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    }
  };

  const reset = () => {
    setStatus('idle');
    setError(null);
    setResult(null);
  };

  return (
    <Card className="border-white/10 bg-zinc-900">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Video className="h-5 w-5" />
          Liveness Verification
        </CardTitle>
        <CardDescription>
          Prove you’re a real person. This helps prevent fake accounts and protects the platform.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {status === 'idle' && (
          <div className="text-center py-8">
            <div className="mx-auto w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mb-4">
              <Camera className="h-8 w-8" />
            </div>
            <p className="mb-6 text-sm text-zinc-400">
              We’ll ask for camera access for ~{requiredDuration} seconds.
              <br />No video is stored — only a liveness signal.
            </p>
            <Button onClick={startLivenessCheck} size="lg">
              Start Webcam Verification
            </Button>
          </div>
        )}

        {(status === 'requesting' || status === 'recording' || status === 'processing') && (
          <div className="space-y-4">
            <div className="relative aspect-video bg-black rounded-xl overflow-hidden border border-white/10">
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                muted
                playsInline
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
              <div className="absolute bottom-4 left-4 right-4">
                <div className="flex items-center gap-2 text-sm">
                  <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                  {status === 'recording' && `Recording liveness check... (${requiredDuration}s)`}
                  {status === 'processing' && 'Analyzing motion and facial features...'}
                </div>
              </div>
            </div>
            <p className="text-center text-xs text-zinc-500">
              Please look at the camera and move naturally.
            </p>
          </div>
        )}

        {status === 'success' && result && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/30 p-6 text-center">
            <CheckCircle className="mx-auto h-12 w-12 text-emerald-400 mb-3" />
            <p className="font-medium text-emerald-400">Liveness verified successfully</p>
            <p className="text-xs text-emerald-400/70 mt-1">
              {result.metadata?.framesAnalyzed} frames analyzed • {result.metadata?.durationSeconds}s
            </p>
            <Button onClick={reset} variant="ghost" size="sm" className="mt-4">
              Re-run verification
            </Button>
          </div>
        )}

        {status === 'error' && (
          <div className="rounded-xl border border-red-500/30 bg-red-950/30 p-6 text-center">
            <AlertCircle className="mx-auto h-10 w-10 text-red-400 mb-3" />
            <p className="font-medium text-red-400">Verification failed</p>
            <p className="text-sm text-red-400/80 mt-1">{error}</p>
            <Button onClick={reset} variant="outline" size="sm" className="mt-4">
              Try again
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
