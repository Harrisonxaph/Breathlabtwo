import React, { useState } from 'react';
import { Minus, Plus, Lock, Unlock, BookmarkPlus, Trash2 } from 'lucide-react';
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
  customPresets: BreathPreset[];
  activePresetId: string | null;
  locked: boolean;
  syncInhaleExhale: boolean;
  onToggleSyncInhaleExhale: () => void;
  onChangeConfig: (next: BreathConfig) => void;
  onSelectPreset: (preset: BreathPreset) => void;
  onSaveCustomPreset: (name: string) => boolean;
  onDeleteCustomPreset: (presetId: string) => void;
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

      <div className="flex items-center gap-2.5">
        <button
          type="button"
          disabled={disabled || value <= min}
          aria-label={decrementLabel}
          onClick={() => onChange(Number((value - step).toFixed(1)))}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-700 hover:text-white disabled:opacity-35 disabled:cursor-not-allowed transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
        >
          <Minus className="w-4 h-4" aria-hidden="true" />
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
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-700 hover:text-white disabled:opacity-35 disabled:cursor-not-allowed transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      {helperText && <p className="text-xs text-slate-400">{helperText}</p>}
    </div>
  );
};

export const ProtocolControls: React.FC<ProtocolControlsProps> = ({
  config,
  customPresets,
  activePresetId,
  locked,
  syncInhaleExhale,
  onToggleSyncInhaleExhale,
  onChangeConfig,
  onSelectPreset,
  onSaveCustomPreset,
  onDeleteCustomPreset,
}) => {
  const [presetNameInput, setPresetNameInput] = useState('');
  const estimatedSec = estimateSessionDurationSec(config);

  const updateField = <K extends keyof BreathConfig>(key: K, value: BreathConfig[K]) => {
    const patch: Partial<BreathConfig> = { [key]: value };
    if (syncInhaleExhale && key === 'inhaleSec') {
      patch.exhaleSec = value as number;
    } else if (syncInhaleExhale && key === 'exhaleSec') {
      patch.inhaleSec = value as number;
    }
    onChangeConfig(clampConfig({ ...config, ...patch }));
  };

  const updateRoundHold = (roundIndex: number, nextSec: number) => {
    const nextOverrides = [...config.roundHoldOverrides];
    nextOverrides[roundIndex] = nextSec;
    updateField('roundHoldOverrides', nextOverrides);
  };

  const handleSavePresetSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!presetNameInput.trim()) return;
    if (onSaveCustomPreset(presetNameInput)) {
      setPresetNameInput('');
    }
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
                ? 'End or complete the session to edit cadence.'
                : 'Settings are remembered automatically.'}
            </p>
          </div>
          <span className="font-mono text-xs text-slate-400 tabular-nums whitespace-nowrap">
            Est. {formatSeconds(estimatedSec)}
          </span>
        </div>

        {/* Presets & Named Custom Presets */}
        <div className="pt-3 pb-3 border-b border-slate-800/70 space-y-2.5">
          <p className="text-xs font-medium text-slate-400">Presets</p>
          <div className="grid grid-cols-2 gap-2">
            {BREATH_PRESETS.map((preset) => {
              const isSelected = activePresetId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  disabled={locked}
                  onClick={() => onSelectPreset(preset)}
                  className={`text-left rounded-xl border px-3 py-2.5 transition-colors min-h-[46px] disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 ${
                    isSelected
                      ? 'border-sky-400/60 bg-sky-400/10 text-slate-100'
                      : 'border-slate-800 bg-slate-900/40 text-slate-300 hover:border-slate-700 hover:bg-slate-900/80'
                  }`}
                >
                  <div className="text-xs font-semibold whitespace-nowrap truncate">
                    {preset.name}
                  </div>
                  <div className="font-mono text-[11px] text-slate-400 mt-0.5 tabular-nums whitespace-nowrap truncate">
                    {preset.config.breathCount} × {preset.config.rounds} · {preset.config.holdSec}s hold
                  </div>
                </button>
              );
            })}
          </div>

          {customPresets.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              {customPresets.map((preset) => {
                const isSelected = activePresetId === preset.id;
                return (
                  <div
                    key={preset.id}
                    className={`flex items-center justify-between gap-1 rounded-xl border pr-1.5 transition-colors ${
                      isSelected
                        ? 'border-sky-400/60 bg-sky-400/10 text-slate-100'
                        : 'border-slate-800 bg-slate-900/40 text-slate-300'
                    }`}
                  >
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => onSelectPreset(preset)}
                      className="flex-1 min-w-0 text-left px-3 py-2 min-h-[44px] disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400 rounded-l-xl"
                    >
                      <div className="text-xs font-semibold truncate">{preset.name}</div>
                      <div className="font-mono text-[11px] text-slate-400 tabular-nums truncate">
                        {preset.config.breathCount} × {preset.config.rounds} · {preset.config.holdSec}s
                      </div>
                    </button>
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => onDeleteCustomPreset(preset.id)}
                      aria-label={`Delete preset ${preset.name}`}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:text-rose-300 hover:bg-slate-800/70 disabled:opacity-35 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <form onSubmit={handleSavePresetSubmit} className="flex gap-2 pt-1">
            <label htmlFor="custom-preset-name" className="sr-only">
              Name your custom preset
            </label>
            <input
              id="custom-preset-name"
              type="text"
              maxLength={32}
              value={presetNameInput}
              disabled={locked}
              onChange={(e) => setPresetNameInput(e.target.value)}
              placeholder="Save current setup as named preset..."
              className="w-full rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs sm:text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-400/70 focus:outline-none min-h-[44px] disabled:opacity-45"
            />
            <button
              type="submit"
              disabled={locked || !presetNameInput.trim()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-200 hover:border-slate-600 hover:text-white disabled:opacity-40 transition-colors min-h-[44px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
            >
              <BookmarkPlus className="w-3.5 h-3.5 text-sky-400" aria-hidden="true" />
              <span>Save</span>
            </button>
          </form>
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
                className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-300 hover:text-sky-200 disabled:opacity-45 transition-colors py-1.5 px-2.5 rounded-lg hover:bg-slate-800/60 min-h-[40px]"
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

          {/* Rounds & Prep Countdown */}
          <div className="py-3 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm font-medium text-slate-200">Rounds</span>
              <div className="inline-flex items-center gap-1 rounded-xl bg-slate-900/90 p-1 border border-slate-800">
                {[1, 2, 3, 4, 5].map((r) => (
                  <button
                    key={r}
                    type="button"
                    disabled={locked}
                    onClick={() => updateField('rounds', r)}
                    aria-label={`${r} ${r === 1 ? 'round' : 'rounds'}`}
                    aria-pressed={config.rounds === r}
                    className={`min-w-[44px] min-h-[44px] rounded-lg font-mono text-xs font-semibold tabular-nums transition-colors disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400 ${
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

            <div className="flex items-center justify-between gap-4">
              <span className="text-sm font-medium text-slate-200">Prep Countdown</span>
              <div className="inline-flex items-center gap-1 rounded-xl bg-slate-900/90 p-1 border border-slate-800">
                {[0, 3, 5, 10].map((sec) => (
                  <button
                    key={sec}
                    type="button"
                    disabled={locked}
                    onClick={() => updateField('prepCountdownSec', sec)}
                    aria-pressed={config.prepCountdownSec === sec}
                    className={`min-w-[44px] min-h-[44px] px-2.5 rounded-lg font-mono text-xs font-semibold tabular-nums transition-colors disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400 ${
                      config.prepCountdownSec === sec
                        ? 'bg-sky-400 text-slate-950'
                        : 'text-slate-400 hover:text-slate-100'
                    }`}
                  >
                    {sec === 0 ? 'Off' : `${sec}s`}
                  </button>
                ))}
              </div>
            </div>

            {config.rounds > 1 && (
              <div className="pt-1 space-y-2.5">
                <label className="inline-flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer select-none min-h-[36px]">
                  <input
                    type="checkbox"
                    disabled={locked}
                    checked={config.roundRetentionCues}
                    onChange={(e) => updateField('roundRetentionCues', e.target.checked)}
                    className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-sky-400 focus:ring-sky-400"
                  />
                  <span>Round-specific retention cues during multi-round holds</span>
                </label>

                <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer select-none min-h-[36px]">
                  <input
                    type="checkbox"
                    disabled={locked}
                    checked={config.useRoundSpecificHolds}
                    onChange={(e) => updateField('useRoundSpecificHolds', e.target.checked)}
                    className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-sky-400 focus:ring-sky-400"
                  />
                  <span>Customize hold length per round</span>
                </label>

                {config.useRoundSpecificHolds && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                    {Array.from({ length: config.rounds }, (_, idx) => {
                      const val = config.roundHoldOverrides[idx] ?? config.holdSec;
                      return (
                        <div
                          key={idx}
                          className="flex items-center justify-between gap-1.5 rounded-xl border border-slate-800 bg-slate-950/50 px-2.5 py-2"
                        >
                          <span className="text-xs text-slate-400">R{idx + 1}</span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              disabled={locked || val <= 5}
                              aria-label={`Decrease round ${idx + 1} hold`}
                              onClick={() => updateRoundHold(idx, val - 5)}
                              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 text-slate-300 hover:text-white disabled:opacity-35"
                            >
                              <Minus className="w-3 h-3" aria-hidden="true" />
                            </button>
                            <span className="font-mono text-xs text-sky-300 tabular-nums min-w-[42px] text-center">
                              {formatSeconds(val)}
                            </span>
                            <button
                              type="button"
                              disabled={locked || val >= 240}
                              aria-label={`Increase round ${idx + 1} hold`}
                              onClick={() => updateRoundHold(idx, val + 5)}
                              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 text-slate-300 hover:text-white disabled:opacity-35"
                            >
                              <Plus className="w-3 h-3" aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Unboxed inline metadata summary */}
      <div className="mt-4 pt-3 border-t border-slate-800/80 text-xs text-slate-400 font-mono tabular-nums flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>
          {config.breathCount} × {config.rounds}
        </span>
        <span aria-hidden="true">·</span>
        <span>
          {config.inhaleSec.toFixed(1)}s in / {config.exhaleSec.toFixed(1)}s out
        </span>
        <span aria-hidden="true">·</span>
        <span>
          {config.rounds > 1 && config.useRoundSpecificHolds
            ? `${config.roundHoldOverrides.slice(0, config.rounds).join('s / ')}s hold`
            : `${formatSeconds(config.holdSec)} hold`}
        </span>
        <span aria-hidden="true">·</span>
        <span>{config.recoveryHoldSec}s recovery</span>
      </div>
    </aside>
  );
};
