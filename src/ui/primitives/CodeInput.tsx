import { forwardRef, useCallback, useImperativeHandle, useRef, useState, type ClipboardEvent, type MouseEvent } from 'react';
import { extractRoomCodeFromPaste, ROOM_CODE_LENGTH, sanitizeRoomCodeInput } from '../../core/roomCode';

export interface CodeInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  describedBy?: string;
  label: string;
}

interface Selection {
  start: number;
  end: number;
}

/**
 * One native text input drawn as four slots. Typing, paste, selection,
 * arrow keys, backspace, and screen readers all use the real input.
 */
export const CodeInput = forwardRef<HTMLInputElement, CodeInputProps>(function CodeInput(
  { id, value, onChange, invalid, describedBy, label },
  forwardedRef,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [sel, setSel] = useState<Selection>({ start: value.length, end: value.length });
  useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement, []);

  const readSelection = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    setSel({ start: el.selectionStart ?? el.value.length, end: el.selectionEnd ?? el.value.length });
  }, []);

  const setCaret = (pos: number, end = pos) => {
    const el = inputRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.setSelectionRange(pos, end);
      readSelection();
    });
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (!text) return;
    e.preventDefault();
    const el = e.currentTarget;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const looksLikeLink = /[?&#]room=\d{4}/.test(text);
    const pasted = looksLikeLink ? extractRoomCodeFromPaste(text) : sanitizeRoomCodeInput(text);
    const next = looksLikeLink ? pasted : sanitizeRoomCodeInput(value.slice(0, start) + pasted + value.slice(end));
    onChange(next);
    setCaret(Math.min(looksLikeLink ? next.length : start + pasted.length, next.length));
  };

  const onMouseUp = (e: MouseEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    if (el.selectionStart !== el.selectionEnd) {
      readSelection();
      return;
    }
    const rect = fieldRef.current?.getBoundingClientRect();
    if (!rect) return;
    const slot = Math.floor(((e.clientX - rect.left) / rect.width) * ROOM_CODE_LENGTH);
    const pos = Math.max(0, Math.min(value.length, slot));
    el.setSelectionRange(pos, pos);
    readSelection();
  };

  const collapsed = sel.start === sel.end;
  const activeIndex = Math.min(sel.start, ROOM_CODE_LENGTH - 1);

  return (
    <div className="code-field" ref={fieldRef} data-invalid={invalid ? '' : undefined}>
      <input
        ref={inputRef}
        id={id}
        className="code-input"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="go"
        pattern="[0-9]{4}"
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        value={value}
        onChange={(e) => {
          const el = e.currentTarget;
          const next = sanitizeRoomCodeInput(el.value);
          const caret = Math.min(el.selectionStart ?? next.length, next.length);
          onChange(next);
          setCaret(caret);
        }}
        onPaste={onPaste}
        onSelect={readSelection}
        onKeyUp={readSelection}
        onMouseUp={onMouseUp}
        onFocus={() => {
          setFocused(true);
          readSelection();
        }}
        onBlur={() => setFocused(false)}
      />
      {Array.from({ length: ROOM_CODE_LENGTH }, (_, i) => {
        const char = value[i] ?? '';
        const selected = focused && !collapsed && i >= sel.start && i < sel.end;
        const active = focused && collapsed && i === activeIndex;
        return (
          <div
            key={i}
            className="code-slot num"
            aria-hidden="true"
            data-active={active ? '' : undefined}
            data-selected={selected ? '' : undefined}
          >
            {char || (active ? <span className="code-caret" /> : null)}
          </div>
        );
      })}
    </div>
  );
});
