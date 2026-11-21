import React, { useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  FastForward,
  Plus,
  Volume2,
  VolumeX,
  Wind,
  CirclePause,
  Sparkles,
  CheckCircle2,
  ArrowDown,
  ArrowUp,
} from 'lucide-react';
import {
  BreathSessionState,
  formatSeconds,
  getBreathVisualScale,
  getPhaseLabel,
  getPhaseProgress,
  BreathPhase,
} from '../utils/breathEngine';
import { getEncouragingInstruction } from '../utils/breathCoaching';

interface BreathVisualizerProps {
  session: BreathSessionState;
  audioEnabled: boolean;
  voiceClipCount: number;
  audioUpdateCaption?: string | null;
  onToggleAudio: () => void;
  onStart: () => void;
  onTogglePause: () => void;
  onSkipPhase: () => void;
  onExtendHold: () => void;
  onReset: () => void;
}

interface PhasePalette {
  stroke: string;
  glow: string;
  softFill: string;
  textClass: string;
  badgeText: string;
}

function getPhasePalette(phase: BreathPhase): PhasePalette {
  switch (phase) {
    case 'inhale':
      return {
        stroke: '#38BDF8',
        glow: 'rgba(56, 189, 248, 0.28)',
        softFill: 'rgba(56, 189, 248, 0.14)',
        textClass: 'text-sky-300',
        badgeText: 'Inhale',
      };
    case 'exhale':
      return {
        stroke: '#2DD4BF',
        glow: 'rgba(45, 212, 191, 0.24)',
        softFill: 'rgba(45, 212, 191, 0.12)',
        textClass: 'text-teal-300',
        badgeText: 'Exhale',
      };
    case 'hold':
      return {
        stroke: '#F59E0B',
        glow: 'rgba(245, 158, 11, 0.26)',
        softFill: 'rgba(245, 158, 11, 0.14)',
        textClass: 'text-amber-300',
        badgeText: 'Hold',
      };
    case 'recovery_inhale':
    case 'recovery_hold':
    case 'recovery_exhale':
      return {
        stroke: '#818CF8',
        glow: 'rgba(129, 140, 248, 0.28)',
        softFill: 'rgba(129, 140, 248, 0.15)',
        textClass: 'text-indigo-300',
        badgeText: 'Recovery',
      };
    case 'completed':
      return {
        stroke: '#34D399',
        glow: 'rgba(52, 211, 153, 0.24)',
        softFill: 'rgba(52, 211, 153, 0.12)',
        textClass: 'text-emerald-300',
        badgeText: 'Complete',
      };
    case 'idle':
    default:
      return {
        stroke: '#38BDF8',
        glow: 'rgba(56, 189, 248, 0.18)',
        softFill: 'rgba(56, 189, 248, 0.08)',
        textClass: 'text-sky-300',
        badgeText: 'Ready',
      };
  }
}

function PhaseIcon({ phase }: { phase: BreathPhase }) {
  const cls = 'w-4 h-4 shrink-0';
  switch (phase) {
    case 'inhale':
      return <ArrowUp className={cls} aria-hidden="true" />;
    case 'exhale':
      return <ArrowDown className={cls} aria-hidden="true" />;
    case 'hold':
      return <CirclePause className={cls} aria-hidden="true" />;
    case 'recovery_inhale':
    case 'recovery_hold':
    case 'recovery_exhale':
      return <Sparkles className={cls} aria-hidden="true" />;
    case 'completed':
      return <CheckCircle2 className={cls} aria-hidden="true" />;
    case 'idle':
    default:
      return <Wind className={cls} aria-hidden="true" />;
  }
}

export const BreathVisualizer: React.FC<BreathVisualizerProps> = ({
  session,
  audioEnabled,
  voiceClipCount,
  audioUpdateCaption,
  onToggleAudio,
  onStart,
  onTogglePause,
  onSkipPhase,
  onExtendHold,
  onReset,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sessionRef = useRef<BreathSessionState>(session);
  const syncPerfRef = useRef<number>(typeof performance !== 'undefined' ? performance.now() : 0);
  const visualScaleRef = useRef<number>(0.32);

  useEffect(() => {
    sessionRef.current = session;
    syncPerfRef.current = performance.now();
  }, [session]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const renderFrame = (timeMs: number) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(240, Math.round(rect.width));
      const height = Math.max(240, Math.round(rect.height));

      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const s = sessionRef.current;
      const palette = getPhasePalette(s.phase);

      // Compute smooth sub-frame progress between 10Hz React state syncs
      const isLive = s.phase !== 'idle' && s.phase !== 'completed' && !s.isPaused;
      const extraMs = isLive ? Math.min(120, Math.max(0, performance.now() - syncPerfRef.current)) : 0;
      const smoothProgress =
        s.phaseDurationMs > 0
          ? Math.min(1, Math.max(0, (s.phaseElapsedMs + extraMs) / s.phaseDurationMs))
          : getPhaseProgress(s);

      const targetScale = getBreathVisualScale(s.phase, smoothProgress);

      // Gentle idle respiration when waiting in idle
      const idleFloat =
        s.phase === 'idle' && !prefersReducedMotion
          ? 0.34 + 0.045 * Math.sin(timeMs * 0.0014)
          : targetScale;

      // Smoothly interpolate visual scale to prevent jumps on skip/reset
      visualScaleRef.current += (idleFloat - visualScaleRef.current) * 0.16;
      const scale = visualScaleRef.current;

      const cx = width / 2;
      const cy = height / 2;
      const maxRadius = Math.min(width, height) * 0.4;
      const minOrbRadius = maxRadius * 0.42;
      const maxOrbRadius = maxRadius * 0.84;
      const orbRadius = minOrbRadius + (maxOrbRadius - minOrbRadius) * scale;

      // 1. Subtle radial ambient backdrop behind the orb
      const ambientGrad = ctx.createRadialGradient(
        cx,
        cy,
        orbRadius * 0.2,
        cx,
        cy,
        maxRadius * 1.15
      );
      ambientGrad.addColorStop(0, palette.glow);
      ambientGrad.addColorStop(0.55, palette.softFill);
      ambientGrad.addColorStop(1, 'rgba(11, 17, 23, 0)');
      ctx.fillStyle = ambientGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, maxRadius * 1.15, 0, Math.PI * 2);
      ctx.fill();

      // 2. Outer perimeter breath dial (1..N tick marks for rhythmic breathing, or arc for hold/recovery)
      const dialRadius = maxRadius * 0.96;
      const totalTicks = s.config.breathCount;

      if (s.phase === 'inhale' || s.phase === 'exhale' || s.phase === 'idle') {
        for (let i = 0; i < totalTicks; i++) {
          const angle = -Math.PI / 2 + (i / totalTicks) * Math.PI * 2;
          const isCompleted = s.phase !== 'idle' && i < s.currentBreath - 1;
          const isCurrent = s.phase !== 'idle' && i === s.currentBreath - 1;

          const innerR = dialRadius - (isCurrent ? 10 : 6);
          const outerR = dialRadius + (isCurrent ? 5 : 2);

          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR);
          ctx.lineTo(cx + Math.cos(angle) * outerR, cy + Math.sin(angle) * outerR);

          if (isCurrent) {
            ctx.strokeStyle = palette.stroke;
            ctx.lineWidth = 2.6;
          } else if (isCompleted) {
            ctx.strokeStyle = 'rgba(56, 189, 248, 0.72)';
            ctx.lineWidth = 2;
          } else {
            ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
            ctx.lineWidth = 1.4;
          }
          ctx.lineCap = 'round';
          ctx.stroke();
        }
      } else {
        // Continuous base ring
        ctx.beginPath();
        ctx.arc(cx, cy, dialRadius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Progress arc for Hold / Recovery / Completed
        const arcProgress = s.phase === 'completed' ? 1 : smoothProgress;
        if (arcProgress > 0) {
          ctx.beginPath();
          ctx.arc(
            cx,
            cy,
            dialRadius,
            -Math.PI / 2,
            -Math.PI / 2 + arcProgress * Math.PI * 2
          );
          ctx.strokeStyle = palette.stroke;
          ctx.lineWidth = 3;
          ctx.lineCap = 'round';
          ctx.stroke();
        }
      }

      // 3. Meditative ripple rings during hold
      if (s.phase === 'hold' && !prefersReducedMotion) {
        for (let r = 0; r < 2; r++) {
          const rippleT = ((timeMs * 0.00028 + r * 0.5) % 1);
          const rippleRadius = orbRadius + (dialRadius - orbRadius) * rippleT * 0.85;
          ctx.beginPath();
          ctx.arc(cx, cy, rippleRadius, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(245, 158, 11, ${(1 - rippleT) * 0.24})`;
          ctx.lineWidth = 1.25;
          ctx.stroke();
        }
      }

      // 4. Multi-layered organic harmonic lobes
      const layers = [
        { lobes: 5, amp: 0.04, speed: 0.0008, phaseOffset: 0, alpha: 0.22 },
        { lobes: 4, amp: 0.03, speed: -0.0006, phaseOffset: 1.7, alpha: 0.34 },
        { lobes: 6, amp: 0.018, speed: 0.00045, phaseOffset: 3.1, alpha: 0.72 },
      ];

      layers.forEach((layer, idx) => {
        const points = 96;
        ctx.beginPath();
        for (let i = 0; i <= points; i++) {
          const theta = (i / points) * Math.PI * 2;
          const wave = prefersReducedMotion
            ? 0
            : Math.sin(theta * layer.lobes + timeMs * layer.speed + layer.phaseOffset) *
              (orbRadius * layer.amp);
          const r = orbRadius * (1 - idx * 0.035) + wave;
          const x = cx + Math.cos(theta) * r;
          const y = cy + Math.sin(theta) * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();

        if (idx === 0) {
          ctx.fillStyle = palette.softFill;
          ctx.fill();
        }
        ctx.strokeStyle = palette.stroke;
        ctx.globalAlpha = layer.alpha;
        ctx.lineWidth = idx === 2 ? 2 : 1.25;
        ctx.stroke();
        ctx.globalAlpha = 1;
      });

      // 5. Inner core translucent circle for unobstructed center readout contrast
      const coreRadius = Math.max(66, orbRadius * 0.74);
      const coreGrad = ctx.createRadialGradient(cx, cy, 4, cx, cy, coreRadius);
      coreGrad.addColorStop(0, 'rgba(11, 17, 23, 0.92)');
      coreGrad.addColorStop(0.85, 'rgba(11, 17, 23, 0.78)');
      coreGrad.addColorStop(1, 'rgba(11, 17, 23, 0)');
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, coreRadius, 0, Math.PI * 2);
      ctx.fill();

      rafId = window.requestAnimationFrame(renderFrame);
    };

    rafId = window.requestAnimationFrame(renderFrame);
    return () => window.cancelAnimationFrame(rafId);
  }, []);

  const palette = getPhasePalette(session.phase);
  const progress = getPhaseProgress(session);
  const remainingSec = Math.max(0, (session.phaseDurationMs - session.phaseElapsedMs) / 1000);
  const isActive = session.phase !== 'idle' && session.phase !== 'completed';
  const isBreathingPhase = session.phase === 'inhale' || session.phase === 'exhale';
  const isRecoveryPhase =
    session.phase === 'recovery_inhale' ||
    session.phase === 'recovery_hold' ||
    session.phase === 'recovery_exhale';

  // Primary center numeric display
  let centerPrimary = `${session.config.breathCount}`;
  let centerSecondary = 'Breaths configured';

  if (isBreathingPhase) {
    centerPrimary = `${session.currentBreath}/${session.config.breathCount}`;
    centerSecondary = `${remainingSec.toFixed(1)}s`;
  } else if (session.phase === 'hold') {
    centerPrimary = formatSeconds(remainingSec);
    centerSecondary = `of ${formatSeconds(session.phaseDurationMs / 1000)} hold`;
  } else if (isRecoveryPhase) {
    centerPrimary = formatSeconds(remainingSec);
    centerSecondary =
      session.phase === 'recovery_inhale'
        ? 'Deep inhale'
        : session.phase === 'recovery_hold'
          ? 'Recovery hold'
          : 'Slow release';
  } else if (session.phase === 'completed') {
    const longestHold =
      session.holdDurationsAchievedSec.length > 0
        ? Math.max(...session.holdDurationsAchievedSec)
        : 0;
    centerPrimary = `${session.totalBreathsCompleted}`;
    centerSecondary =
      longestHold > 0
        ? `Best hold ${formatSeconds(longestHold)}`
        : 'Breaths completed';
  }

  return (
    <section
      aria-label="Breath Visualizer Stage"
      data-testid="breath-stage"
      data-phase={session.phase}
      data-breath={session.currentBreath}
      data-paused={session.isPaused ? 'true' : 'false'}
      className="relative flex flex-col justify-between rounded-2xl border border-slate-800/80 bg-[#101822] p-5 sm:p-6 min-h-[540px] lg:min-h-[620px]"
    >
      {/* Top stage toolbar */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5 text-sm text-slate-300">
          <span className={`inline-flex items-center gap-1.5 font-medium ${palette.textClass}`}>
            <PhaseIcon phase={session.phase} />
            <span>{session.isPaused ? `${getPhaseLabel(session.phase)} (Paused)` : getPhaseLabel(session.phase)}</span>
          </span>
          {session.config.rounds > 1 && (
            <>
              <span aria-hidden="true" className="text-slate-600">
                ·
              </span>
              <span className="font-mono text-xs text-slate-400 tabular-nums">
                Round {session.currentRound} of {session.config.rounds}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <a
            href="#voice"
            className="inline-flex items-center rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-xs font-medium text-slate-300 hover:border-slate-700 hover:text-slate-100 transition-colors min-h-[40px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
          >
            {voiceClipCount > 0 ? `Voice (${voiceClipCount})` : 'Voice Audio'}
          </a>

          <button
            type="button"
            onClick={onToggleAudio}
            aria-pressed={audioEnabled}
            aria-label={audioEnabled ? 'Mute audio cues' : 'Enable audio cues'}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs font-medium text-slate-300 hover:border-slate-700 hover:text-slate-100 transition-colors min-h-[40px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
          >
            {audioEnabled ? (
              <Volume2 className="w-4 h-4 text-sky-400" aria-hidden="true" />
            ) : (
              <VolumeX className="w-4 h-4 text-slate-500" aria-hidden="true" />
            )}
            <span>{audioEnabled ? 'Sound On' : 'Sound Off'}</span>
          </button>
        </div>
      </div>

      {/* Central canvas & HUD overlay */}
      <div className="relative my-3 flex-1 flex items-center justify-center min-h-[340px] sm:min-h-[400px]">
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className="w-full h-full max-w-[460px] max-h-[460px] aspect-square block"
        />

        {/* Crisp centered accessible readout */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center px-4">
          <p className={`text-xs font-medium tracking-wide ${palette.textClass}`}>
            {session.isPaused ? 'Paused' : getPhaseLabel(session.phase)}
          </p>
          <p
            data-testid="stage-primary-readout"
            className="mt-1 font-mono text-4xl sm:text-5xl font-semibold tracking-tight text-slate-50 tabular-nums"
          >
            {centerPrimary}
          </p>
          <p className="mt-1.5 font-mono text-xs sm:text-sm text-slate-400 tabular-nums">
            {centerSecondary}
          </p>
        </div>
      </div>

      {/* Instruction + Stage Controls */}
      <div className="space-y-4">
        <div className="text-center space-y-1.5">
          <p
            data-testid="encouraging-message"
            className="text-sm text-slate-200 max-w-md mx-auto min-h-[1.25rem] transition-opacity duration-300"
          >
            {getEncouragingInstruction(session)}
          </p>
          {audioUpdateCaption && (
            <p
              data-testid="audio-update-caption"
              aria-live="polite"
              className="font-mono text-xs text-sky-300/90 tabular-nums"
            >
              Audio cue: {audioUpdateCaption}
            </p>
          )}
          {isActive && (
            <div className="pt-1.5 max-w-xs mx-auto">
              <div className="h-1 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded-full transition-transform duration-100 origin-left"
                  style={{
                    backgroundColor: palette.stroke,
                    transform: `scaleX(${progress})`,
                  }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
          {session.phase === 'idle' && (
            <button
              type="button"
              onClick={onStart}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-400 px-6 py-3 text-sm font-semibold text-slate-950 hover:bg-sky-300 active:scale-[0.99] transition-all min-h-[44px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
            >
              <Play className="w-4 h-4 fill-current" aria-hidden="true" />
              <span>Start Session</span>
            </button>
          )}

          {isActive && (
            <>
              <button
                type="button"
                onClick={onTogglePause}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-400 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-sky-300 transition-colors min-h-[44px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
              >
                {session.isPaused ? (
                  <>
                    <Play className="w-4 h-4 fill-current" aria-hidden="true" />
                    <span>Resume</span>
                  </>
                ) : (
                  <>
                    <Pause className="w-4 h-4" aria-hidden="true" />
                    <span>Pause</span>
                  </>
                )}
              </button>

              {session.phase === 'hold' && (
                <button
                  type="button"
                  onClick={onExtendHold}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm font-medium text-amber-200 hover:bg-amber-500/20 transition-colors min-h-[44px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
                >
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  <span>15s Hold</span>
                </button>
              )}

              <button
                type="button"
                onClick={onSkipPhase}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900/70 px-4 py-2.5 text-sm font-medium text-slate-200 hover:border-slate-600 hover:bg-slate-800/80 transition-colors min-h-[44px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
              >
                <FastForward className="w-4 h-4" aria-hidden="true" />
                <span>
                  {isBreathingPhase
                    ? 'Skip to Hold'
                    : session.phase === 'hold'
                      ? 'Proceed to Recovery'
                      : 'Skip Phase'}
                </span>
              </button>

              <button
                type="button"
                onClick={onReset}
                aria-label="Reset session"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-800 bg-transparent px-4 py-2.5 text-sm font-medium text-slate-400 hover:border-slate-700 hover:text-slate-200 transition-colors min-h-[44px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
              >
                <RotateCcw className="w-4 h-4" aria-hidden="true" />
                <span>Reset</span>
              </button>
            </>
          )}

          {session.phase === 'completed' && (
            <>
              <button
                type="button"
                onClick={onStart}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-400 px-6 py-3 text-sm font-semibold text-slate-950 hover:bg-sky-300 transition-colors min-h-[44px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
              >
                <Play className="w-4 h-4 fill-current" aria-hidden="true" />
                <span>Repeat Session</span>
              </button>
              <button
                type="button"
                onClick={onReset}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900/70 px-5 py-3 text-sm font-medium text-slate-200 hover:border-slate-600 hover:bg-slate-800 transition-colors min-h-[44px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
              >
                <RotateCcw className="w-4 h-4" aria-hidden="true" />
                <span>Back to Setup</span>
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
};
