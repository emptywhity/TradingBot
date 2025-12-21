import React, { useEffect, useMemo, useState } from 'react';
import { clearMetaModel, loadMetaModel, saveMetaModel, tryParseMetaModel } from '@/services/metaModel';
import { Signal } from '@/types';

export function MetaModelManager({
  open,
  onClose,
  signals,
  onChanged
}: {
  open: boolean;
  onClose: () => void;
  signals: Signal[];
  onChanged?: () => void;
}) {
  const existing = useMemo(() => (open ? loadMetaModel() : null), [open]);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setText(existing ? JSON.stringify(existing, null, 2) : '');
    setError(null);
    setSavedAt(null);
  }, [existing, open]);

  if (!open) return null;

  const downloadSignals = () => {
    const blob = new Blob([JSON.stringify(signals, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fsd-signals-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const onSave = () => {
    setError(null);
    const parsed = tryParseMetaModel(text);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    saveMetaModel(parsed.model);
    setSavedAt(Date.now());
    onChanged?.();
  };

  const onClear = () => {
    clearMetaModel();
    setText('');
    setError(null);
    setSavedAt(Date.now());
    onChanged?.();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onMouseDown={onClose}>
      <div
        className="w-full max-w-2xl rounded-xl border border-slate-800 bg-slate-950 p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Meta-model"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-slate-100">Meta-model (optional)</h3>
            <p className="text-xs text-slate-400 mt-1">
              Paste a trained model JSON to filter alerts by estimated quality. Informational only.
            </p>
          </div>
          <button
            className="shrink-0 rounded-md border border-slate-800 bg-slate-900 px-3 py-1 text-xs text-slate-200 hover:border-slate-600"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="text-xs text-slate-400">
              Status: {existing ? <span className="text-emerald-300">loaded</span> : <span className="text-slate-500">no model</span>}
              {savedAt ? <span className="text-slate-500"> • updated {new Date(savedAt).toLocaleTimeString()}</span> : null}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={downloadSignals}
                className="rounded-md border border-slate-800 bg-slate-900 px-3 py-1 text-xs text-slate-200 hover:border-slate-600"
              >
                Export signals JSON
              </button>
              <button
                type="button"
                onClick={onClear}
                className="rounded-md border border-slate-800 bg-slate-900 px-3 py-1 text-xs text-slate-200 hover:border-slate-600"
              >
                Clear model
              </button>
              <button
                type="button"
                onClick={onSave}
                className="rounded-md border border-slate-800 bg-slate-900 px-3 py-1 text-xs text-slate-200 hover:border-slate-600"
              >
                Save model
              </button>
            </div>
          </div>

          {error ? <div className="text-xs text-rose-300 mb-2">{error}</div> : null}

          <textarea
            className="w-full h-64 font-mono text-[11px] bg-slate-900/40 border border-slate-800 rounded p-2 text-slate-100"
            placeholder='Paste JSON like: {"version":"fsd-meta-v1","features":["score","rr","stopPct","atrPct","adx","bbBw","emaSlope","trend"],"weights":[...],"bias":...,"means":[...],"stds":[...],"threshold":0.55}'
            value={text}
            onChange={(e) => setText(e.target.value)}
          />

          <div className="mt-2 text-[11px] text-slate-500">
            Features supported: score, rr, stopPct, atrPct, adx, bbBw, emaSlope, trend.
          </div>
        </div>
      </div>
    </div>
  );
}
