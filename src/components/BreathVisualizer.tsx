import React, { useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  Square,
  FastForward,
  Volume2,
  VolumeX,
  Wind,
  CirclePause,
  Sparkles,
  CheckCircle2,
  ArrowDown,
  ArrowUp,
  Maximize2,
  Minimize2,
  HeartHandshake,
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
  isFocusMode: boolean;
  reducedMotion: boolean;
  wakeLockActive: boolean;
  onToggleFocusMode: () => void;
  onToggleAudio: () => void;
  onStart: () => void;
  onTogglePause: () => void;
  onResumeAfterInterruption: () => void;
  onTakeRecoveryBreath: () => void;
  onSkipPhase: () => void;
  onEndSession: () => void;
  onBackToSetup: () => void;
}

interface PhasePalette {
  stroke: string;
  glow: string;
  softFill: string;
  textClass: string;
}

function getPhasePalette(phase: BreathPhase): PhasePalette {
  switch (phase) {
    case 'preparing':
      return {
        stroke: '#94A3B8',
        glow: 'rgba(148, 163, 184, 0.18)',
        softFill: 'rgba(148, 163, 184, 0.1)',
        textClass: 'text-slate-200',
      };
    case 'inhale':
      return {
        stroke: '#38BDF8',
        glow: 'rgba(56, 189, 248, 0.28)',
        softFill: 'rgba(56, 189, 248, 0.14)',
        textClass: 'text-sky-300',
      };
    case 'exhale':
      return {
        stroke: '#2DD4BF',
        glow: 'rgba(45, 212, 191, 0.24)',
        softFill: 'rgba(45, 212, 191, 0.12)',
        textClass: 'text-teal-300',
      };
    case 'hold':
      return {
        stroke: '#F59E0B',
        glow: 'rgba(245, 158, 11, 0.24)',
        softFill: 'rgba(245, 158, 11, 0.14)',
        textClass: 'text-amber-300',
      };
    case 'recovery_inhale':
    case 'recovery_hold':
    case 'recovery_exhale':
      return {
        stroke: '#818CF8',
        glow: 'rgba(129, 140, 248, 0.28)',
        softFill: 'rgba(129, 140, 248, 0.15)',
        textClass: 'text-indigo-300',
      };
    case 'completed':
      return {
        stroke: '#34D399',
        glow: 'rgba(52, 211, 153, 0.24)',
        softFill: 'rgba(52, 211, 153, 0.12)',
        textClass: 'text-emerald-300',
      };
    case 'idle':
    default:
      return {
        stroke: '#38BDF8',
        glow: 'rgba(56, 189, 248, 0.18)',
        softFill: 'rgba(56, 189, 248, 0.08)',
        textClass: 'text-sky-300',
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
    case 'preparing':
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
  isFocusMode,
  reducedMotion,
  wakeLockActive,
  onToggleFocusMode,
  onToggleAudio,
  onStart,
  onTogglePause,
  onResumeAfterInterruption,
  onTakeRecoveryBreath,
  onSkipPhase,
  onEndSession,
  onBackToSetup,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sessionRef = useRef<BreathSessionState>(session);
  const reducedMotionRef = useRef<boolean>(reducedMotion);
  const syncPerfRef = useRef<number>(typeof performance !== 'undefined' ? performance.now() : 0);
  const visualScaleRef = useRef<number>(0.32);

  useEffect(() => {
    sessionRef.current = session;
    syncPerfRef.current = performance.now();
  }, [session]);

  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
  }, [reducedMotion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;

    const renderFrame = (timeMs: number) => {
      const systemReducedMotion =
        typeof window !== 'undefined' &&
        window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const isReduced = reducedMotionRef.current || systemReducedMotion;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(220, Math.round(rect.width));
      const height = Math.max(220, Math.round(rect.height));

      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const s = sessionRef.current;
      const palette = getPhasePalette(s.phase);

      const isLive = s.phase !== 'idle' && s.phase !== 'completed' && !s.isPaused;
      const extraMs = isLive ? Math.min(120, Math.max(0, performance.now() - syncPerfRef.current)) : 0;
      const smoothProgress =
        s.phaseDurationMs > 0
          ? Math.min(1, Math.max(0, (s.phaseElapsedMs + extraMs) / s.phaseDurationMs))
          : getPhaseProgress(s);

      const targetScale = getBreathVisualScale(s.phase, smoothProgress);
      const idleFloat =
        s.phase === 'idle' && !isReduced
          ? 0.34 + 0.04 * Math.sin(timeMs * 0.0014)
          : targetScale;

      if (isReduced) {
        visualScaleRef.current += (idleFloat - visualScaleRef.current) * 0.25;
      } else {
        visualScaleRef.current += (idleFloat - visualScaleRef.current) * 0.16;
      }
      const scale = visualScaleRef.current;

      const cx = width / 2;
      const cy = height / 2;
      const maxRadius = Math.min(width, height) * 0.4;
      const minOrbRadius = maxRadius * 0.42;
      const maxOrbRadius = maxRadius * 0.84;
      const orbRadius = minOrbRadius + (maxOrbRadius - minOrbRadius) * scale;

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
        ctx.beginPath();
        ctx.arc(cx, cy, dialRadius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
        ctx.lineWidth = 2;
        ctx.stroke();

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

      if (s.phase === 'hold' && !isReduced) {
        for (let r = 0; r < 2; r++) {
          const rippleT = (timeMs * 0.00028 + r * 0.5) % 1;
          const rippleRadius = orbRadius + (dialRadius - orbRadius) * rippleT * 0.85;
          ctx.beginPath();
          ctx.arc(cx, cy, rippleRadius, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(245, 158, 11, ${(1 - rippleT) * 0.24})`;
          ctx.lineWidth = 1.25;
          ctx.stroke();
        }
      }

      if (isReduced) {
        // Calm static concentric geometry when reduced motion is preferred
        ctx.beginPath();
        ctx.arc(cx, cy, orbRadius, 0, Math.PI * 2);
        ctx.fillStyle = palette.softFill;
        ctx.fill();
        ctx.strokeStyle = palette.stroke;
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
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
            const wave =
              Math.sin(theta * layer.lobes + timeMs * layer.speed + layer.phaseOffset) *
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
      }

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
  const isInterruptedPause = Boolean(session.isPaused && session.interruptionReason);

  let centerPrimary = `${session.config.breathCount} × ${session.config.rounds}`;
  let centerSecondary = 'Breaths & rounds';

  if (session.phase === 'preparing') {
    centerPrimary = `${Math.max(1, Math.ceil(remainingSec))}s`;
    centerSecondary = 'Starting soon';
  } else if (isBreathingPhase) {
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
    centerPrimary = `${session.totalBreathsCompleted}`;
    centerSecondary = session.endedEarly ? 'Session ended safely' : 'Breaths completed';
  }

  const containerClasses = isFocusMode
    ? 'fixed inset-0 z-50 flex flex-col justify-between bg-[#070B10] min-h-[100dvh] px-4 sm:px-8 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1.25rem+env(safe-area-inset-bottom))] overflow-y-auto'
    : 'relative flex flex-col justify-between rounded-2xl border border-slate-800/80 bg-[#101822] p-5 sm:p-6 min-h-[540px] lg:min-h-[620px]';

  return (
    <section
      aria-label="Breath Visualizer Stage"
      data-testid="breath-stage"
      data-phase={session.phase}
      data-breath={session.currentBreath}
      data-round={session.currentRound}
      data-paused={session.isPaused ? 'true' : 'false'}
      data-interrupted={isInterruptedPause ? 'true' : 'false'}
      data-focus={isFocusMode ? 'true' : 'false'}
      className={containerClasses}
    >
      {/* Top stage toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-slate-300">
          <span className={`inline-flex items-center gap-1.5 font-medium ${palette.textClass}`}>
            <PhaseIcon phase={session.phase} />
            <span>
              {session.isPaused
                ? `${getPhaseLabel(session.phase)} (Paused)`
                : getPhaseLabel(session.phase)}
            </span>
          </span>
          {session.config.rounds > 1 && session.phase !== 'idle' && (
            <>
              <span aria-hidden="true" className="text-slate-600">
                ·
              </span>
              <span className="font-mono text-xs text-slate-400 tabular-nums">
                Round {session.currentRound} of {session.config.rounds}
              </span>
            </>
          )}
          {wakeLockActive && isActive && !session.isPaused && (
            <>
              <span aria-hidden="true" className="text-slate-600">
                ·
              </span>
              <span className="text-xs text-slate-400">Screen awake</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {!isFocusMode && (
            <a
              href="#voice"
              className="inline-flex items-center rounded-xl border border-slate-800 bg-slate-900/50 px-3.5 py-2 text-xs font-medium text-slate-300 hover:border-slate-700 hover:text-slate-100 transition-colors min-h-[44px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
            >
              {voiceClipCount > 0 ? `Voice (${voiceClipCount})` : 'Audio'}
            </a>
          )}

          <button
            type="button"
            onClick={onToggleAudio}
            aria-pressed={audioEnabled}
            aria-label={audioEnabled ? 'Mute audio cues' : 'Enable audio cues'}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/70 px-3.5 py-2 text-xs font-medium text-slate-300 hover:border-slate-700 hover:text-slate-100 transition-colors min-h-[44px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
          >
            {audioEnabled ? (
              <Volume2 className="w-4 h-4 text-sky-400" aria-hidden="true" />
            ) : (
              <VolumeX className="w-4 h-4 text-slate-500" aria-hidden="true" />
            )}
            <span>{audioEnabled ? 'Sound On' : 'Sound Off'}</span>
          </button>

          <button
            type="button"
            onClick={onToggleFocusMode}
            aria-pressed={isFocusMode}
            aria-label={isFocusMode ? 'Exit focus mode' : 'Enter focus mode'}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900/70 px-3.5 py-2 text-xs font-medium text-slate-300 hover:border-slate-700 hover:text-slate-100 transition-colors min-h-[44px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
          >
            {isFocusMode ? (
              <>
                <Minimize2 className="w-4 h-4 text-sky-400" aria-hidden="true" />
                <span>Exit Focus</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-4 h-4 text-slate-300" aria-hidden="true" />
                <span>Focus Mode</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Central canvas & HUD overlay */}
      <div
        className={`relative my-3 flex-1 flex items-center justify-center ${
          isFocusMode ? 'min-h-[360px]' : 'min-h-[320px] sm:min-h-[380px]'
        }`}
      >
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className={`w-full h-full aspect-square block ${
            isFocusMode ? 'max-w-[520px] max-h-[520px]' : 'max-w-[440px] max-h-[440px]'
          }`}
        />

        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center px-4">
          <p className={`text-xs font-medium tracking-wide ${palette.textClass}`}>
            {session.isPaused ? 'Paused' : getPhaseLabel(session.phase)}
          </p>
          <p
            data-testid="stage-primary-readout"
            className={`mt-1 font-mono font-semibold tracking-tight text-slate-50 tabular-nums ${
              isFocusMode ? 'text-5xl sm:text-6xl' : 'text-4xl sm:text-5xl'
            }`}
          >
            {centerPrimary}
          </p>
          <p className="mt-1.5 font-mono text-xs sm:text-sm text-slate-400 tabular-nums">
            {centerSecondary}
          </p>
        </div>
      </div>

      {/* Interruption auto-pause notice OR instruction + Stage Controls */}
      <div className={`space-y-4 ${isFocusMode ? 'max-w-2xl w-full mx-auto' : ''}`}>
        {isInterruptedPause ? (
          <div
            role="status"
            data-testid="interruption-prompt"
            className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-center space-y-3"
          >
            <p className="text-sm font-semibold text-amber-200">
              Session paused automatically
            </p>
            <p className="text-xs sm:text-sm text-slate-200 leading-relaxed max-w-md mx-auto">
              Your screen locked, switched apps, or audio was interrupted. Take a few slow, natural breaths and breathe normally before resuming.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
              <button
                type="button"
                onClick={onResumeAfterInterruption}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-400 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-sky-300 transition-colors min-h-[48px] whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
              >
                <Play className="w-4 h-4 fill-current" aria-hidden="true" />
                <span>I&apos;m Breathing Normally — Resume</span>
              </button>
              <button
                type="button"
                onClick={onEndSession}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-500/50 bg-rose-500/15 px-5 py-3 text-sm font-semibold text-rose-200 hover:bg-rose-500/25 transition-colors min-h-[48px] whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-400"
              >
                <Square className="w-4 h-4 fill-current" aria-hidden="true" />
                <span>End Session</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center space-y-1.5">
            <p
              data-testid="encouraging-message"
              className="text-sm text-slate-200 max-w-md mx-auto min-h-[1.25rem]"
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
                <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full origin-left ${
                      reducedMotion ? '' : 'transition-transform duration-100'
                    }`}
                    style={{
                      backgroundColor: palette.stroke,
                      transform: `scaleX(${progress})`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Prominent Thumb-Friendly Stage Action Bar */}
        {!isInterruptedPause && (
          <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
            {session.phase === 'idle' && (
              <button
                type="button"
                onClick={onStart}
                className="inline-flex items-center justify-center gap-2.5 rounded-xl bg-sky-400 px-7 py-3.5 text-sm font-semibold text-slate-950 hover:bg-sky-300 transition-colors min-h-[50px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
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
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-400 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-sky-300 transition-colors min-h-[48px] sm:min-h-[52px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
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
                    onClick={onTakeRecoveryBreath}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-400 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-indigo-300 transition-colors min-h-[48px] sm:min-h-[52px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
                  >
                    <HeartHandshake className="w-4 h-4" aria-hidden="true" />
                    <span>Take Recovery Breath</span>
                  </button>
                )}

                {session.phase !== 'hold' && (
                  <button
                    type="button"
                    onClick={onSkipPhase}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900/70 px-4 py-3 text-sm font-medium text-slate-200 hover:border-slate-600 hover:bg-slate-800/80 transition-colors min-h-[48px] sm:min-h-[52px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
                  >
                    <FastForward className="w-4 h-4" aria-hidden="true" />
                    <span>
                      {session.phase === 'preparing'
                        ? 'Begin Breaths'
                        : isBreathingPhase
                          ? 'Skip to Hold'
                          : 'Skip Phase'}
                    </span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={onEndSession}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-500/45 bg-rose-500/15 px-5 py-3 text-sm font-semibold text-rose-200 hover:bg-rose-500/25 transition-colors min-h-[48px] sm:min-h-[52px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-400"
                >
                  <Square className="w-4 h-4 fill-current" aria-hidden="true" />
                  <span>End Session</span>
                </button>
              </>
            )}

            {session.phase === 'completed' && (
              <>
                <button
                  type="button"
                  onClick={onStart}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-400 px-6 py-3 text-sm font-semibold text-slate-950 hover:bg-sky-300 transition-colors min-h-[48px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
                >
                  <Play className="w-4 h-4 fill-current" aria-hidden="true" />
                  <span>Repeat Session</span>
                </button>
                <button
                  type="button"
                  onClick={onBackToSetup}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900/70 px-5 py-3 text-sm font-medium text-slate-200 hover:border-slate-600 hover:bg-slate-800 transition-colors min-h-[48px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
                >
                  <span>Back to Setup</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
};
