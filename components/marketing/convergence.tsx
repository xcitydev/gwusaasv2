import { Cpu, Database, Settings, ShieldCheck, Zap } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

/**
 * Convergence stage (References/how-it-works.html): scattered UI fragments
 * pulled into a pulsing core by radar rings. The reference's white core is
 * rendered in the site orange. Decorative only — pointer events are off.
 */

const CARD =
  "animate-gravity-well absolute left-1/2 top-1/2 z-20 rounded-xl border border-white/10 bg-white/[0.02] p-3 shadow-[0_10px_30px_rgba(0,0,0,0.5)] backdrop-blur-md";

function Card({
  tx,
  ty,
  rot,
  delay,
  className,
  children,
}: {
  tx: number;
  ty: number;
  rot: number;
  delay: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`${CARD} ${className ?? ""}`}
      style={
        {
          "--tx": `${tx}px`,
          "--ty": `${ty}px`,
          "--rot": `${rot}deg`,
          animationDelay: `${delay}s`,
        } as CSSProperties
      }
    >
      {children}
    </div>
  );
}

export function Convergence() {
  return (
    <div
      aria-hidden
      className="relative z-10 mx-auto flex h-[640px] max-h-[94vw] w-[640px] max-w-[94vw] scale-[0.72] items-center justify-center md:scale-100"
    >
      {/* Ambient base glow */}
      <div className="pointer-events-none absolute h-[300px] w-[300px] rounded-full bg-white/[0.04] opacity-80 blur-[60px]" />

      {/* Radar pull rings */}
      {[0, 1.33, 2.66].map((delay) => (
        <div
          key={delay}
          className="animate-radar-pull pointer-events-none absolute left-1/2 top-1/2 h-[600px] w-[600px] rounded-full border-solid border-white/20"
          style={{ animationDelay: `${delay}s` }}
        />
      ))}

      {/* Central converging core — the site orange where the reference is white */}
      <div className="animate-core-pulse pointer-events-none absolute left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2">
        <div className="absolute inset-0 animate-pulse rounded-full bg-orange-400 opacity-20 blur-xl" />
        <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-orange-400 text-black shadow-[0_0_60px_rgba(251,146,60,0.7),inset_0_0_20px_rgba(0,0,0,0.2)] before:absolute before:-inset-4 before:animate-[spin_6s_linear_infinite] before:rounded-full before:border before:border-dashed before:border-orange-400/40">
          <Zap className="size-8 animate-pulse" fill="currentColor" strokeWidth={1.5} />
        </div>
      </div>

      {/* Scattered converging elements */}
      <Card tx={-240} ty={-240} rot={15} delay={0.2} className="flex w-32 flex-col gap-1.5">
        <div className="h-1.5 w-1/2 rounded bg-white/20" />
        <div className="h-1.5 w-3/4 rounded bg-white/40" />
        <div className="h-1.5 w-2/3 rounded bg-white/20" />
      </Card>

      <Card tx={260} ty={-180} rot={-20} delay={0.6} className="text-neutral-300">
        <Database className="size-5" strokeWidth={1.5} />
      </Card>

      <Card tx={-180} ty={260} rot={30} delay={1.0} className="p-2.5">
        <div className="relative h-4 w-8 rounded-full bg-white/20">
          <div className="absolute right-1 top-[2px] h-3 w-3 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.8)]" />
        </div>
      </Card>

      <Card tx={220} ty={220} rot={-10} delay={1.4} className="flex items-center gap-2 px-4 py-2">
        <div className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.5)]" />
        <span className="font-mono text-xs text-white">99.9%</span>
      </Card>

      <Card tx={-320} ty={20} rot={25} delay={1.8} className="flex h-12 w-16 items-end gap-1.5">
        <div className="h-1/3 w-2 rounded-t bg-white/20" />
        <div className="h-2/3 w-2 rounded-t bg-white/40" />
        <div className="h-1/2 w-2 rounded-t bg-white/60" />
        <div className="h-full w-2 rounded-t bg-white/80 shadow-[0_0_8px_rgba(255,255,255,0.4)]" />
      </Card>

      <Card tx={300} ty={60} rot={-25} delay={2.2} className="text-neutral-300">
        <Settings className="size-5" strokeWidth={1.5} />
      </Card>

      <Card tx={-80} ty={-300} rot={40} delay={2.6} className="flex items-center gap-2 p-2">
        <div className="h-6 w-6 rounded-full border border-white/20 bg-gradient-to-tr from-white/20 to-white/5" />
        <div className="h-1.5 w-8 rounded bg-white/20" />
      </Card>

      <Card tx={100} ty={-280} rot={-15} delay={3.0} className="text-emerald-400">
        <ShieldCheck className="size-5" strokeWidth={1.5} />
      </Card>

      <Card tx={-120} ty={320} rot={20} delay={3.4} className="w-24">
        <div className="relative h-1 w-full rounded-full bg-white/10">
          <div className="absolute left-1/3 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.6)]" />
        </div>
      </Card>

      <Card tx={160} ty={300} rot={-35} delay={3.8} className="text-neutral-300">
        <Cpu className="size-5" strokeWidth={1.5} />
      </Card>

      <Card tx={-340} ty={-120} rot={10} delay={4.2} className="w-20">
        <svg viewBox="0 0 100 20" className="h-4 w-full overflow-visible">
          <path
            d="M0,10 Q15,20 25,10 T50,10 T75,5 T100,10"
            fill="none"
            stroke="rgba(255,255,255,0.6)"
            strokeWidth="2"
          />
        </svg>
      </Card>

      <Card tx={340} ty={-80} rot={-5} delay={4.6} className="flex w-24 flex-col gap-1.5">
        <div className="h-1.5 w-full rounded bg-emerald-400/40" />
        <div className="h-1.5 w-2/3 rounded bg-white/20" />
      </Card>
    </div>
  );
}
