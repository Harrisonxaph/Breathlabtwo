import React, { useEffect, useState } from 'react';
import { Download, Smartphone, WifiOff, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../utils/usePWAInstall';

export const PWAInstallControl: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const isOnline = useOnlineStatus();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  useEffect(() => {
    if (!showIOSGuide) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowIOSGuide(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showIOSGuide]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5">
        {!isOnline && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-300">
            <WifiOff className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>Offline Mode — Bundled audio ready</span>
          </span>
        )}

        {!isInstalled && isInstallable && (
          <button
            type="button"
            onClick={() => void install()}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/80 px-3.5 py-2 text-xs font-medium text-slate-100 hover:border-sky-400/60 hover:text-white transition-colors min-h-[44px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
          >
            <Download className="w-3.5 h-3.5 text-sky-400" aria-hidden="true" />
            <span>Install App</span>
          </button>
        )}

        {!isInstalled && !isInstallable && isIOS && (
          <button
            type="button"
            onClick={() => setShowIOSGuide(true)}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/80 px-3.5 py-2 text-xs font-medium text-slate-100 hover:border-sky-400/60 hover:text-white transition-colors min-h-[44px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
          >
            <Smartphone className="w-3.5 h-3.5 text-sky-400" aria-hidden="true" />
            <span>Add to Home Screen</span>
          </button>
        )}
      </div>

      {showIOSGuide && (
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/80 p-0 sm:p-4"
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="ios-install-title"
            className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl border border-slate-800 bg-[#101822] p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 id="ios-install-title" className="font-display text-base font-semibold text-slate-100">
                Install BREATHFLOW on iPhone / iPad
              </h3>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                aria-label="Close installation guide"
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-800 text-slate-400 hover:text-slate-100"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
            <ol className="space-y-2 text-sm text-slate-300 leading-relaxed list-decimal list-inside">
              <li>
                Open this page in <strong className="text-slate-100">Safari</strong> and tap the{' '}
                <strong className="text-slate-100">Share</strong> button.
              </li>
              <li>
                Scroll down and choose{' '}
                <strong className="text-slate-100">Add to Home Screen</strong>.
              </li>
              <li>
                Launch <strong className="text-slate-100">BREATHFLOW</strong> anytime—even offline with all 45 voice clips cached.
              </li>
            </ol>
            <button
              type="button"
              onClick={() => setShowIOSGuide(false)}
              className="w-full rounded-xl bg-sky-400 py-3 text-sm font-semibold text-slate-950 hover:bg-sky-300 transition-colors min-h-[44px]"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </>
  );
};
