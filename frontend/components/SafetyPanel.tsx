'use client';

import React, { useState } from 'react';
import { Shield, AlertTriangle, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { checkPromptSafety } from '@/lib/safety';
import { LivenessVerification } from './LivenessVerification';

export function SafetyPanel() {
  const [prompt, setPrompt] = useState('');
  const [safetyResult, setSafetyResult] = useState<ReturnType<typeof checkPromptSafety> | null>(null);
  const [livenessDone, setLivenessDone] = useState(false);

  const testPrompt = () => {
    const result = checkPromptSafety(prompt);
    setSafetyResult(result);
  };

  return (
    <div className="space-y-6">
      {/* Liveness */}
      <Card className="border-white/10 bg-zinc-900">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" /> Identity & Liveness
          </CardTitle>
          <CardDescription>
            Required before training or high-value actions. Prevents deepfake abuse.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!livenessDone ? (
            <LivenessVerification
              onVerified={() => setLivenessDone(true)}
              requiredDuration={4}
            />
          ) : (
            <div className="flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-950/30 p-4 text-emerald-400">
              <CheckCircle className="h-5 w-5" />
              <span>Liveness verified. You can now proceed with training uploads.</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Prompt Safety */}
      <Card className="border-white/10 bg-zinc-900">
        <CardHeader>
          <CardTitle>Prompt Safety (Blocklist)</CardTitle>
          <CardDescription>
            Harmful, NSFW, or illegal prompts are blocked before they reach the generation model.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="Try a prompt: 'beautiful woman in lingerie'"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && testPrompt()}
              className="bg-zinc-950"
            />
            <Button onClick={testPrompt} variant="outline">Test</Button>
          </div>

          {safetyResult && (
            <div className={`rounded-lg p-4 text-sm ${safetyResult.safe ? 'bg-emerald-950/40 border border-emerald-500/30 text-emerald-400' : 'bg-red-950/40 border border-red-500/30 text-red-400'}`}>
              {safetyResult.safe ? (
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4" /> Prompt is safe.
                </div>
              ) : (
                <div>
                  <div className="flex items-center gap-2 font-medium">
                    <AlertTriangle className="h-4 w-4" /> Prompt blocked
                  </div>
                  <div className="mt-1 text-xs opacity-80">{safetyResult.message}</div>
                </div>
              )}
            </div>
          )}

          <div className="text-[10px] text-zinc-500">
            Blocklist contains {checkPromptSafety('').blockedTerms.length} terms (NSFW, violence, minors, hate, etc.).
            Full list enforced server-side as well.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
