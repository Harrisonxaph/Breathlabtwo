import React from 'react';
import { Trash2 } from 'lucide-react';
import { SessionRecord, formatSeconds } from '../utils/breathEngine';

interface SessionHistoryAndGuideProps {
  history: SessionRecord[];
  onClearHistory: () => void;
}

export const SessionHistoryAndGuide: React.FC<SessionHistoryAndGuideProps> = ({
  history,
  onClearHistory,
}) => {
  return (
    <div className="space-y-14 pt-6">
      {/* Session History Section */}
      <section id="history" aria-labelledby="history-heading" className="scroll-mt-20 space-y-5">
        <div className="flex items-end justify-between gap-4 border-b border-slate-800/80 pb-4">
          <div>
            <h2 id="history-heading" className="font-display text-2xl font-semibold text-slate-100">
              Recent Sessions
            </h2>
            <p className="text-sm text-slate-400 mt-1">
              Completed rounds and achieved retention hold times stored locally in your browser.
            </p>
          </div>
          {history.length > 0 && (
            <button
              type="button"
              onClick={onClearHistory}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-3.5 py-2 text-xs font-medium text-slate-300 hover:border-slate-700 hover:text-slate-100 transition-colors min-h-[40px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
            >
              <Trash2 className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
              <span>Clear Log</span>
            </button>
          )}
        </div>

        {history.length === 0 ? (
          <div className="rounded-xl border border-slate-800/80 bg-[#101822]/70 px-6 py-8 text-center">
            <p className="text-sm font-medium text-slate-300">No completed sessions logged yet</p>
            <p className="text-xs text-slate-400 mt-1">
              Finish a breathing cycle, breath hold, and recovery breath to record your session metrics here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-800/80 bg-[#101822]">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800/80 text-xs font-medium text-slate-400">
                  <th className="py-3.5 px-4">Session</th>
                  <th className="py-3.5 px-4">Breaths</th>
                  <th className="py-3.5 px-4">Hold Achieved</th>
                  <th className="py-3.5 px-4">Recovery</th>
                  <th className="py-3.5 px-4 text-right">Total Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {history.map((item) => {
                  const dateLabel = new Date(item.timestamp).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  });
                  const holdsText =
                    item.holdLengthsSec.length > 0
                      ? item.holdLengthsSec.map((s) => formatSeconds(s)).join(', ')
                      : '—';

                  return (
                    <tr key={item.id} className="hover:bg-slate-900/40 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="font-medium text-slate-200">{item.presetName}</div>
                        <div className="text-xs text-slate-400 mt-0.5">{dateLabel}</div>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-xs text-slate-300 tabular-nums">
                        {item.totalBreaths} ({item.roundsCompleted} {item.roundsCompleted === 1 ? 'round' : 'rounds'})
                      </td>
                      <td className="py-3.5 px-4 font-mono text-xs text-amber-300 tabular-nums">
                        {holdsText}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-xs text-indigo-300 tabular-nums">
                        {item.recoveryHoldSec}s
                      </td>
                      <td className="py-3.5 px-4 font-mono text-xs text-slate-300 tabular-nums text-right">
                        {formatSeconds(item.totalDurationSec)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Protocol Guide Section */}
      <section id="guide" aria-labelledby="guide-heading" className="scroll-mt-20 space-y-6 pb-8">
        <div className="border-b border-slate-800/80 pb-4">
          <h2 id="guide-heading" className="font-display text-2xl font-semibold text-slate-100">
            Three-Phase Breathwork Guide
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Each round follows a deliberate progression from rhythmic ventilation to stillness and recovery.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="rounded-xl border border-slate-800/80 bg-[#101822] p-5 space-y-2">
            <h3 className="font-display text-base font-semibold text-sky-300">
              01. Rhythmic Breaths (1–40)
            </h3>
            <p className="text-sm text-slate-300 leading-relaxed">
              Follow the expanding orb for steady, connected inhales and relaxed exhales. Use 10–20 breaths for a brief reset, or 30–40 breaths for deeper somatic intensity.
            </p>
          </div>

          <div className="rounded-xl border border-slate-800/80 bg-[#101822] p-5 space-y-2">
            <h3 className="font-display text-base font-semibold text-amber-300">
              02. Breath Hold (Retention)
            </h3>
            <p className="text-sm text-slate-300 leading-relaxed">
              After the final exhale, rest comfortably with empty lungs. You can extend your hold by 15 seconds anytime or release early into the recovery breath whenever you feel the urge to breathe.
            </p>
          </div>

          <div className="rounded-xl border border-slate-800/80 bg-[#101822] p-5 space-y-2">
            <h3 className="font-display text-base font-semibold text-indigo-300">
              03. Recovery Breath
            </h3>
            <p className="text-sm text-slate-300 leading-relaxed">
              Draw one full, expansive breath to the top of your lungs and hold calmly for your chosen recovery length before releasing slowly to close the round.
            </p>
          </div>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed max-w-3xl">
          Safety note: Practice breathwork seated or lying down in a safe environment. Never practice rhythmic breathing or breath holds while driving, swimming, bathing, or standing where dizziness could cause injury.
        </p>
      </section>
    </div>
  );
};
