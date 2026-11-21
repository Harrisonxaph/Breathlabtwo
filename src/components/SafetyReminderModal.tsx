import React, { useEffect } from 'react';
import { Play, ShieldAlert, X } from 'lucide-react';

interface SafetyReminderModalProps {
  open: boolean;
  prepCountdownSec: number;
  rounds: number;
  breathCount: number;
  onConfirmStart: () => void;
  onPlaySafetyAudio: () => void;
  onCancel: () => void;
}

export const SafetyReminderModal: React.FC<SafetyReminderModalProps> = ({
  open,
  prepCountdownSec,
  rounds,
  breathCount,
  onConfirmStart,
  onPlaySafetyAudio,
  onCancel,
}) => {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/80 p-0 sm:p-4"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="safety-dialog-title"
        className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl border border-slate-800 bg-[#101822] p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:p-6 shadow-2xl space-y-5"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-300 border border-amber-500/30">
              <ShieldAlert className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h2
                id="safety-dialog-title"
                className="font-display text-lg font-semibold text-slate-50"
              >
                Before You Begin
              </h2>
              <p className="text-xs text-slate-400 mt-0.5 font-mono tabular-nums">
                {breathCount} breaths × {rounds} {rounds === 1 ? 'round' : 'rounds'}
                {prepCountdownSec > 0 ? ` · ${prepCountdownSec}s preparation` : ''}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onCancel}
            aria-label="Close safety reminder"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-slate-900/70 text-slate-400 hover:text-slate-100 hover:border-slate-700 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <ul className="space-y-2.5 text-sm text-slate-200 leading-relaxed border-y border-slate-800/80 py-4">
          <li>
            <span className="font-semibold text-slate-50">Sit or lie down safely.</span>{' '}
            Never practice breathwork while driving, swimming, bathing, or standing where dizziness could cause injury.
          </li>
          <li>
            <span className="font-semibold text-slate-50">Never force a breath hold.</span>{' '}
            Tingling or warmth is normal, but end the hold or take your recovery breath the moment your body signals to breathe.
          </li>
          <li>
            <span className="font-semibold text-slate-50">Stop anytime.</span>{' '}
            If you feel uncomfortable, tap End Session and return to gentle, natural breathing.
          </li>
          <li className="text-xs text-slate-400">
            Avoid intense rhythmic breathing if pregnant or if you have uncontrolled blood pressure, seizure disorders, or cardiovascular conditions unless cleared by a clinician.
          </li>
        </ul>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <button
            type="button"
            onClick={onPlaySafetyAudio}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900/70 px-4 py-3 text-xs font-medium text-slate-200 hover:border-slate-600 hover:text-white transition-colors min-h-[48px] whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
          >
            <Play className="w-3.5 h-3.5 text-amber-400 fill-current" aria-hidden="true" />
            <span>Play Safety Audio</span>
          </button>

          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-2.5">
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex items-center justify-center rounded-xl border border-slate-800 bg-transparent px-4 py-3 text-sm font-medium text-slate-300 hover:border-slate-700 hover:text-white transition-colors min-h-[48px] whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirmStart}
              className="inline-flex items-center justify-center rounded-xl bg-sky-400 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-sky-300 transition-colors min-h-[48px] whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
            >
              I&apos;m Seated Safely — Start
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
