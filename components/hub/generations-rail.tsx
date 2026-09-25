"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ArrowRight, Images, Loader2 } from "lucide-react";
import { findImageModel, findMotionModel, findVideoModel } from "@/lib/ai-models";
import { findStudioModel } from "@/lib/studio-models";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function modelLabel(id: string): string {
  return (
    findStudioModel(id)?.label ??
    findImageModel(id)?.label ??
    findVideoModel(id)?.label ??
    findMotionModel(id)?.label ??
    id
  );
}

/** The newest results, always in view next to the chat. */
export function GenerationsRail({ onOpenLibrary }: { onOpenLibrary: () => void }) {
  const generations = useQuery(api.generations.list);
  const recent = (generations ?? []).slice(0, 12);

  return (
    <Card className="lg:sticky lg:top-24">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Images className="size-4 text-primary" /> Generations
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={onOpenLibrary}>
          Library <ArrowRight className="size-3.5" />
        </Button>
      </CardHeader>
      <CardContent>
        {generations === undefined ? (
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="aspect-square rounded-lg" />
            ))}
          </div>
        ) : recent.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Your renders show up here as they land.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {recent.map((g) => {
              const busy = g.status === "pending" || g.status === "running";
              const isVideo = g.kind === "video" || g.kind === "motion";
              const inner = (
                <>
                  {g.resultUrl && !busy ? (
                    isVideo ? (
                      <video
                        src={g.resultUrl}
                        muted
                        playsInline
                        preload="metadata"
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={g.resultUrl}
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    )
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center bg-secondary">
                      {busy ? (
                        <Loader2 className="size-4 animate-spin text-primary" />
                      ) : (
                        <span className="text-[10px] text-muted-foreground">
                          {g.status === "failed" ? "failed" : "—"}
                        </span>
                      )}
                    </div>
                  )}
                  <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-4 text-left text-[10px] text-white/90">
                    {modelLabel(g.model)}
                  </span>
                </>
              );
              return g.resultUrl && !busy ? (
                <a
                  key={g._id}
                  href={g.resultUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-secondary"
                  title={g.prompt}
                >
                  {inner}
                </a>
              ) : (
                <div
                  key={g._id}
                  className="relative aspect-square overflow-hidden rounded-lg border border-border bg-secondary"
                  title={g.prompt}
                >
                  {inner}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
