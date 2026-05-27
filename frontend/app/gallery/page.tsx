"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Download,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";

type GenerationStatus = "succeeded" | "processing" | "failed" | "queued";

interface Generation {
  id: string;
  promptPack: string;
  prompt: string;
  status: GenerationStatus;
  progress: number;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  width: number;
  height: number;
  createdAt: string;
  durationMs?: number;
  modelTriggerWord: string;
}

interface ListResponse {
  items: Generation[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

const PAGE_SIZE = 12;
const STATUS_FILTERS: Array<{ key: GenerationStatus | "all"; label: string }> =
  [
    { key: "all", label: "All" },
    { key: "succeeded", label: "Completed" },
    { key: "processing", label: "Processing" },
    { key: "queued", label: "Queued" },
    { key: "failed", label: "Failed" },
  ];

export default function GalleryPage() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<GenerationStatus | "all">(
    "all",
  );
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Generation | null>(null);
  const [zoom, setZoom] = useState(1);

  const fetchPage = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/generations?${params}`);
      const json = (await res.json()) as ListResponse;
      setData(json);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load gallery");
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  /* eslint-disable react-hooks/set-state-in-effect -- intentional: fetch data when deps change */
  useEffect(() => {
    fetchPage();
  }, [fetchPage]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Live progress updates via SSE for non-terminal jobs on this page.
  const liveIds = useMemo(
    () =>
      data?.items
        .filter((g) => g.status === "processing" || g.status === "queued")
        .map((g) => g.id) ?? [],
    [data],
  );

  useEffect(() => {
    if (liveIds.length === 0) return;
    const es = new EventSource(
      `/api/generations/stream?ids=${encodeURIComponent(liveIds.join(","))}`,
    );
    const applyUpdate = (
      updates: Array<{
        id: string;
        status: GenerationStatus;
        progress: number;
        imageUrl: string | null;
      }>,
    ) => {
      setData((prev) => {
        if (!prev) return prev;
        const byId = new Map(updates.map((u) => [u.id, u]));
        return {
          ...prev,
          items: prev.items.map((g) => {
            const u = byId.get(g.id);
            if (!u) return g;
            return {
              ...g,
              status: u.status,
              progress: u.progress,
              imageUrl: u.imageUrl ?? g.imageUrl,
              thumbnailUrl:
                u.imageUrl && !g.thumbnailUrl
                  ? u.imageUrl.replace("/768/1024", "/384/512")
                  : g.thumbnailUrl,
            };
          }),
        };
      });
    };
    es.addEventListener("snapshot", (e) =>
      applyUpdate(JSON.parse((e as MessageEvent).data)),
    );
    es.addEventListener("progress", (e) =>
      applyUpdate(JSON.parse((e as MessageEvent).data)),
    );
    es.addEventListener("done", () => es.close());
    es.onerror = () => es.close();
    return () => es.close();
  }, [liveIds.join(",")]);

  const totalPages = data
    ? Math.max(1, Math.ceil(data.total / data.pageSize))
    : 1;

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="border-b border-white/10">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-white" />
            <span className="font-semibold text-xl">AIStudio</span>
            <span className="text-zinc-500">/ Gallery</span>
          </div>
          <Button variant="ghost" onClick={() => window.history.back()}>
            ← Back
          </Button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-10">
        <header className="mb-8">
          <h1 className="text-4xl font-semibold tracking-tight">
            Your generations
          </h1>
          <p className="text-zinc-400 mt-1">
            {data ? `${data.total} total` : "Loading…"} — click any image to
            open the viewer
          </p>
        </header>

        <div className="flex flex-wrap gap-2 mb-6">
          {STATUS_FILTERS.map((f) => (
            <Button
              key={f.key}
              size="sm"
              variant={statusFilter === f.key ? "default" : "outline"}
              onClick={() => {
                setStatusFilter(f.key);
                setPage(1);
              }}
            >
              {f.label}
            </Button>
          ))}
        </div>

        {loading && !data ? (
          <div className="flex items-center justify-center py-24 text-zinc-500">
            <Loader2 className="h-6 w-6 mr-2 animate-spin" /> Loading gallery…
          </div>
        ) : data && data.items.length === 0 ? (
          <Card className="border-white/10 bg-zinc-900">
            <CardContent className="py-16 text-center text-zinc-400">
              No generations match this filter yet.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {data?.items.map((g) => (
              <GalleryTile
                key={g.id}
                g={g}
                onOpen={() => {
                  setSelected(g);
                  setZoom(1);
                }}
              />
            ))}
          </div>
        )}

        {data && data.total > data.pageSize && (
          <div className="flex items-center justify-between mt-8">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="h-4 w-4 mr-1" /> Previous
            </Button>
            <div className="text-sm text-zinc-400">
              Page {page} of {totalPages}
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={!data.hasMore || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}
      </div>

      <ViewerDialog
        generation={selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        zoom={zoom}
        setZoom={setZoom}
      />
    </div>
  );
}

function GalleryTile({ g, onOpen }: { g: Generation; onOpen: () => void }) {
  const isDone = g.status === "succeeded";
  return (
    <button
      onClick={isDone ? onOpen : undefined}
      className={`group relative aspect-[3/4] overflow-hidden rounded-xl border border-white/10 bg-zinc-900 text-left ${
        isDone ? "cursor-zoom-in hover:border-white/30" : "cursor-default"
      }`}
    >
      {isDone && g.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={g.thumbnailUrl}
          alt={g.prompt}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover transition-transform group-hover:scale-[1.03]"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <StatusBadge status={g.status} progress={g.progress} />
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium truncate">{g.promptPack}</span>
          <StatusPill status={g.status} />
        </div>
      </div>

      {isDone && (
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition">
          <Maximize2 className="h-4 w-4" />
        </div>
      )}
    </button>
  );
}

function StatusPill({ status }: { status: GenerationStatus }) {
  if (status === "succeeded") {
    return (
      <span className="text-[10px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
        <CheckCircle2 className="h-3 w-3" /> done
      </span>
    );
  }
  if (status === "processing") {
    return (
      <span className="text-[10px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/30">
        <Loader2 className="h-3 w-3 animate-spin" /> running
      </span>
    );
  }
  if (status === "queued") {
    return (
      <span className="text-[10px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-zinc-500/15 text-zinc-300 border border-zinc-500/30">
        <Clock className="h-3 w-3" /> queued
      </span>
    );
  }
  return (
    <span className="text-[10px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-300 border border-red-500/30">
      <AlertTriangle className="h-3 w-3" /> failed
    </span>
  );
}

function StatusBadge({
  status,
  progress,
}: {
  status: GenerationStatus;
  progress: number;
}) {
  if (status === "processing" || status === "queued") {
    return (
      <div className="text-center">
        <Loader2 className="h-8 w-8 animate-spin mx-auto text-zinc-400 mb-3" />
        <div className="text-xs text-zinc-400">
          {status === "queued" ? "Queued" : `Generating ${progress}%`}
        </div>
        <div className="mt-2 mx-auto h-1 w-24 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full bg-white/70 transition-all"
            style={{ width: `${Math.max(2, progress)}%` }}
          />
        </div>
      </div>
    );
  }
  return (
    <div className="text-center px-3">
      <AlertTriangle className="h-8 w-8 mx-auto text-red-400 mb-2" />
      <div className="text-xs text-red-300">Generation failed</div>
    </div>
  );
}

function ViewerDialog({
  generation,
  onOpenChange,
  zoom,
  setZoom,
}: {
  generation: Generation | null;
  onOpenChange: (open: boolean) => void;
  zoom: number;
  setZoom: (z: number) => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);

  const download = async () => {
    if (!generation?.imageUrl) return;
    try {
      const res = await fetch(generation.imageUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${generation.id}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Image downloaded");
    } catch (err) {
      console.error(err);
      toast.error("Download failed");
    }
  };

  return (
    <Dialog open={!!generation} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl bg-zinc-950 border-white/10">
        {generation && (
          <>
            <DialogHeader>
              <DialogTitle>{generation.promptPack}</DialogTitle>
              <DialogDescription className="text-zinc-400">
                {generation.prompt}
              </DialogDescription>
            </DialogHeader>

            <div className="relative max-h-[70vh] overflow-auto rounded-xl border border-white/10 bg-black">
              {generation.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  ref={imgRef}
                  src={generation.imageUrl}
                  alt={generation.prompt}
                  style={{
                    transform: `scale(${zoom})`,
                    transformOrigin: "top left",
                    width: `${100 / zoom}%`,
                  }}
                  className="block transition-transform"
                />
              )}
            </div>

            <div className="flex items-center justify-between gap-3 mt-2">
              <div className="text-xs text-zinc-500">
                {generation.width}×{generation.height}
                {generation.durationMs &&
                  ` • ${(generation.durationMs / 1000).toFixed(1)}s`}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}
                  disabled={zoom <= 0.5}
                >
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <span className="text-xs tabular-nums w-12 text-center">
                  {(zoom * 100).toFixed(0)}%
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setZoom(Math.min(4, zoom + 0.25))}
                  disabled={zoom >= 4}
                >
                  <ZoomIn className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  onClick={download}
                  disabled={!generation.imageUrl}
                >
                  <Download className="h-4 w-4 mr-1" /> Download
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
