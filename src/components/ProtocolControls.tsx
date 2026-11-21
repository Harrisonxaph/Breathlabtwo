import React from 'react';
import { Minus, Plus, Lock, Unlock } from 'lucide-react';
import {
  BREATH_PRESETS,
  BreathConfig,
  BreathPreset,
  clampConfig,
  estimateSessionDurationSec,
  formatSeconds,
} from '../utils/breathEngine';

interface ProtocolControlsProps {
  config: BreathConfig;
  activePresetId: string | null;
  locked: boolean;
  syncInhaleExhale: boolean;
  onToggleSyncInhaleExhale: () => void;
  onChangeConfig: (next: BreathConfig) => void;
  onSelectPreset: (preset: BreathPreset) => void;
}

interface SliderRowProps {
  id: string;
  label: string;
  valueDisplay: string;
  min: number;
  max: number;
  step: number;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
  decrementLabel: string;
  incrementLabel: string;
  helperText?: string;
}

const SliderRow: React.FC<SliderRowProps> = ({
  id,
  label,
  valueDisplay,
  min,
  max,
  step,
  value,
  disabled,
  onChange,
  decrementLabel,
  incrementLabel,
  helperText,
}) => {
  return (
    <div className="space-y-2 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-slate-200">
          {label}
        </label>
        <span className="font-mono text-sm font-semibold text-sky-300 tabular-nums whitespace-nowrap">
          {valueDisplay}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={disabled || value <= min}
          aria-label={decrementLabel}
          onClick={() => onChange(Number((value - step).toFixed(1)))}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-700 hover:text-white disabled:opacity-35 disabled:cursor-not-allowed transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
        >
          <Minus className="w-3.5 h-3.5" aria-hidden="true" />
        </button>

        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="breath-slider w-full disabled:opacity-45 disabled:cursor-not-allowed"
        />

        <button
          type="button"
          disabled={disabled || value >= max}
          aria-label={incrementLabel}
          onClick={() => onChange(Number((value + step).toFixed(1)))}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-700 hover:text-white disabled:opacity-35 disabled:cursor-not-allowed transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
        >
          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>

      {helperText && <p className="text-xs text-slate-400">{helperText}</p>}
    </div>
  );
};

export const ProtocolControls: React.FC<ProtocolControlsProps> = ({
  config,
  activePresetId,
  locked,
  syncInhaleExhale,
  onToggleSyncInhaleExhale,
  onChangeConfig,
  onSelectPreset,
}) => {
  const estimatedSec = estimateSessionDurationSec(config);

  const updateField = <K extends keyof BreathConfig>(key: K, value: number) => {
    const patch: Partial<BreathConfig> = { [key]: value };
    if (syncInhaleExhale && key === 'inhaleSec') {
      patch.exhaleSec = value;
    } else if (syncInhaleExhale && key === 'exhaleSec') {
      patch.inhaleSec = value;
    }
    onChangeConfig(clampConfig({ ...config, ...patch }));
  };

  return (
    <aside
      id="presets"
      aria-label="Session Protocol Controls"
      className="rounded-2xl border border-slate-800/80 bg-[#101822] p-5 flex flex-col justify-between h-full"
    >
      <div>
        <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-100">
              Protocol Setup
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {locked
                ? 'Reset or complete the round to adjust timings.'
                : 'Tune breaths, hold duration, and recovery.'}
            </p>
          </div>
          <span className="font-mono text-xs text-slate-400 tabular-nums whitespace-nowrap">
            Est. {formatSeconds(estimatedSec)}
          </span>
        </div>

        {/* Presets */}
        <div className="pt-3 pb-2.5 border-b border-slate-800/70">
          <p className="text-xs font-medium text-slate-400 mb-2">Quick Presets</p>
          <div className="grid grid-cols-2 gap-2">
            {BREATH_PRESETS.map((preset) => {
              const isSelected = activePresetId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  disabled={locked}
                  onClick={() => onSelectPreset(preset)}
                  className={`text-left rounded-lg border px-3 py-2 transition-colors min-h-[42px] disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 ${
                    isSelected
                      ? 'border-sky-400/60 bg-sky-400/10 text-slate-100'
                      : 'border-slate-800 bg-slate-900/40 text-slate-300 hover:border-slate-700 hover:bg-slate-900/80'
                  }`}
                >
                  <div className="text-xs font-semibold whitespace-nowrap truncate">
                    {preset.name}
                  </div>
                  <div className="font-mono text-[11px] text-slate-400 mt-0.5 tabular-nums whitespace-nowrap truncate">
                    {preset.config.breathCount} breaths · {preset.config.holdSec}s hold
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Sliders */}
        <div className="divide-y divide-slate-800/70">
          <SliderRow
            id="slider-breath-count"
            label="Inhale / Exhale Cycles"
            valueDisplay={`${config.breathCount} ${config.breathCount === 1 ? 'breath' : 'breaths'}`}
            min={1}
            max={40}
            step={1}
            value={config.breathCount}
            disabled={locked}
            onChange={(v) => updateField('breathCount', v)}
            decrementLabel="Decrease breath count"
            incrementLabel="Increase breath count"
          />

          <div className="py-2.5 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-400">
                Rhythmic Breath Pace
              </span>
              <button
                type="button"
                disabled={locked}
                onClick={onToggleSyncInhaleExhale}
                aria-pressed={syncInhaleExhale}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-300 hover:text-sky-200 disabled:opacity-45 transition-colors py-1 px-2 rounded-md hover:bg-slate-800/60"
              >
                {syncInhaleExhale ? (
                  <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                ) : (
                  <Unlock className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                )}
                <span>{syncInhaleExhale ? 'Equal Pace Linked' : 'Independent Pace'}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
              <SliderRow
                id="slider-inhale-sec"
                label="Inhale"
                valueDisplay={`${config.inhaleSec.toFixed(1)}s`}
                min={1.0}
                max={6.0}
                step={0.2}
                value={config.inhaleSec}
                disabled={locked}
                onChange={(v) => updateField('inhaleSec', v)}
                decrementLabel="Decrease inhale duration"
                incrementLabel="Increase inhale duration"
              />

              <SliderRow
                id="slider-exhale-sec"
                label="Exhale"
                valueDisplay={`${config.exhaleSec.toFixed(1)}s`}
                min={1.0}
                max={6.0}
                step={0.2}
                value={config.exhaleSec}
                disabled={locked}
                onChange={(v) => updateField('exhaleSec', v)}
                decrementLabel="Decrease exhale duration"
                incrementLabel="Increase exhale duration"
              />
            </div>
          </div>

          <SliderRow
            id="slider-hold-sec"
            label="Breath Hold Length"
            valueDisplay={formatSeconds(config.holdSec)}
            min={5}
            max={240}
            step={5}
            value={config.holdSec}
            disabled={locked}
            onChange={(v) => updateField('holdSec', v)}
            decrementLabel="Decrease breath hold duration"
            incrementLabel="Increase breath hold duration"
          />

          <SliderRow
            id="slider-recovery-hold-sec"
            label="Recovery Breath Hold"
            valueDisplay={`${config.recoveryHoldSec}s`}
            min={5}
            max={45}
            step={1}
            value={config.recoveryHoldSec}
            disabled={locked}
            onChange={(v) => updateField('recoveryHoldSec', v)}
            decrementLabel="Decrease recovery hold duration"
            incrementLabel="Increase recovery hold duration"
            helperText={`Preceded by a ${config.recoveryInhaleSec.toFixed(1)}s deep recovery inhale.`}
          />

          {/* Rounds selector */}
          <div className="pt-2.5 pb-1 flex items-center justify-between gap-4">
            <span className="text-sm font-medium text-slate-200">Rounds</span>
            <div className="inline-flex items-center gap-1 rounded-lg bg-slate-900/90 p-1 border border-slate-800">
              {[1, 2, 3, 4, 5].map((r) => (
                <button
                  key={r}
                  type="button"
                  disabled={locked}
                  onClick={() => updateField('rounds', r)}
                  aria-label={`${r} ${r === 1 ? 'round' : 'rounds'}`}
                  aria-pressed={config.rounds === r}
                  className={`min-w-[36px] min-h-[36px] rounded-md font-mono text-xs font-semibold tabular-nums transition-colors disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400 ${
                    config.rounds === r
                      ? 'bg-sky-400 text-slate-950'
                      : 'text-slate-400 hover:text-slate-100'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Unboxed inline metadata summary */}
      <div className="mt-4 pt-3 border-t border-slate-800/80 text-xs text-slate-400 font-mono tabular-nums flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>
          {config.breathCount} {config.breathCount === 1 ? 'breath' : 'breaths'}
        </span>
        <span aria-hidden="true">·</span>
        <span>
          {config.inhaleSec.toFixed(1)}s in / {config.exhaleSec.toFixed(1)}s out
        </span>
        <span aria-hidden="true">·</span>
        <span>{formatSeconds(config.holdSec)} hold</span>
        <span aria-hidden="true">·</span>
        <span>{config.recoveryHoldSec}s recovery</span>
      </div>
    </aside>
  );
};
