import { useId, type CSSProperties } from 'react';

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /** Visible label text; when omitted the label is only exposed to assistive tech. */
  showLabel?: boolean;
  valueText?: (value: number) => string;
  /** Fill from the midpoint (signed values like timing trim). */
  centered?: boolean;
  dim?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
  ring?: string;
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  showLabel,
  valueText,
  centered,
  dim,
  disabled,
  id,
  className,
  ring,
}: SliderProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const pct = ((value - min) / (max - min)) * 100;
  const mid = centered ? ((0 - min) / (max - min)) * 100 : 0;
  const style = {
    '--fill-from': `${Math.min(mid, pct)}%`,
    '--fill-to': `${centered ? Math.max(mid, pct) : pct}%`,
    ...(ring ? { '--slider-ring': ring } : {}),
  } as CSSProperties;
  return (
    <>
      {showLabel ? (
        <label className="field-label" htmlFor={inputId}>
          {label}
        </label>
      ) : null}
      <input
        id={inputId}
        type="range"
        className={['slider', className].filter(Boolean).join(' ')}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={showLabel ? undefined : label}
        aria-valuetext={valueText ? valueText(value) : undefined}
        data-dim={dim ? '' : undefined}
        style={style}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      />
    </>
  );
}
