import React from 'react';

export const SafetyAndGuide: React.FC = () => {
  return (
    <section id="guide" aria-labelledby="guide-heading" className="scroll-mt-20 space-y-6 pt-4 pb-8">
      <div className="border-b border-slate-800/80 pb-4">
        <h2 id="guide-heading" className="font-display text-2xl font-semibold text-slate-100">
          Three-Phase Breathwork Guide
        </h2>
        <p className="text-sm text-slate-400 mt-1">
          Each round moves deliberately from connected rhythmic breathing into gentle stillness and recovery.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="rounded-xl border border-slate-800/80 bg-[#101822] p-5 space-y-2">
          <h3 className="font-display text-base font-semibold text-sky-300">
            01. Rhythmic Breaths (1–40)
          </h3>
          <p className="text-sm text-slate-300 leading-relaxed">
            Follow the expanding orb for steady, connected inhales and soft, unforced exhales. Pause or switch to recovery anytime you need a rest.
          </p>
        </div>

        <div className="rounded-xl border border-slate-800/80 bg-[#101822] p-5 space-y-2">
          <h3 className="font-display text-base font-semibold text-amber-300">
            02. Breath Hold (Retention)
          </h3>
          <p className="text-sm text-slate-300 leading-relaxed">
            After the final exhale, rest comfortably without forcing anything. Tap Take Recovery Breath the moment your body signals the urge to inhale.
          </p>
        </div>

        <div className="rounded-xl border border-slate-800/80 bg-[#101822] p-5 space-y-2">
          <h3 className="font-display text-base font-semibold text-indigo-300">
            03. Recovery Breath
          </h3>
          <p className="text-sm text-slate-300 leading-relaxed">
            Draw one full, comfortable breath in, settle calmly at the top, and exhale slowly to let your natural breathing rhythm return.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800/80 bg-[#101822]/70 p-5 space-y-2 text-xs text-slate-300 leading-relaxed">
        <p>
          <span className="font-semibold text-slate-100">Safety &amp; Privacy:</span> Practice seated or lying down away from water, driving, or standing hazards. If your screen locks or you switch apps during a session, BREATHFLOW pauses automatically so you can breathe normally before resuming.
        </p>
        <p className="text-slate-400">
          No session history, hold durations, or health logs are saved. Only your chosen cadence settings, named presets, and audio preferences stay on this device.
        </p>
      </div>
    </section>
  );
};
