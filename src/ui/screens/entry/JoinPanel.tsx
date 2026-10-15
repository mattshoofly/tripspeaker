import { AlertCircle, ArrowLeft, LoaderCircle } from 'lucide-react';
import { forwardRef, useImperativeHandle, useRef, useState, type FormEvent } from 'react';
import { isValidRoomCode } from '../../../core/roomCode';
import type { ConnectionReport } from '../../../net/diagnose';
import { JOIN_ERROR_COPY, type JoinErrorKind } from '../../../net/errors';
import { cancelJoin, joinRoom } from '../../../session/app';
import { loadPrefs } from '../../../session/prefs';
import { Button } from '../../primitives/Button';
import { CodeInput } from '../../primitives/CodeInput';
import { ConnectionHelp } from '../../ConnectionHelp';

export interface JoinPanelHandle {
  focusCode: () => void;
}

interface JoinPanelProps {
  initialCode: string;
  onBack: () => void;
  disabled?: boolean;
}

export const JoinPanel = forwardRef<JoinPanelHandle, JoinPanelProps>(function JoinPanel({ initialCode, onBack, disabled }, ref) {
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState(() => loadPrefs().deviceName);
  const [error, setError] = useState<JoinErrorKind | null>(null);
  const [report, setReport] = useState<ConnectionReport | null>(null);
  const [pending, setPending] = useState(false);
  const codeRef = useRef<HTMLInputElement | null>(null);
  const attempt = useRef(0);

  useImperativeHandle(ref, () => ({ focusCode: () => codeRef.current?.focus({ preventScroll: true }) }), []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending || disabled) return;
    if (!isValidRoomCode(code)) {
      setError('invalid-code');
      codeRef.current?.focus();
      return;
    }
    setError(null);
    setReport(null);
    setPending(true);
    const mine = ++attempt.current;
    const result = await joinRoom(code, name);
    if (mine !== attempt.current) return;
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      setReport(result.report ?? null);
      codeRef.current?.focus();
    }
  };

  const cancel = () => {
    attempt.current++;
    cancelJoin();
    setPending(false);
  };

  const copy = error ? JOIN_ERROR_COPY[error] : null;

  return (
    <form className="join" onSubmit={submit} noValidate aria-labelledby="join-title">
      <button type="button" className="back-link" onClick={() => (pending ? (cancel(), onBack()) : onBack())}>
        <ArrowLeft aria-hidden="true" />
        Back
      </button>
      <div>
        <h2 id="join-title" className="join-title">
          Join your friends.
        </h2>
      </div>
      <p className="join-lead">Enter the four-digit code on the host’s screen.</p>
      <div className="join-fields">
        <div className="field">
          <span className="field-label" id="join-code-label">
            Room code
          </span>
          <CodeInput
            ref={codeRef}
            id="join-code"
            label="Room code, four digits"
            value={code}
            onChange={(v) => {
              setCode(v);
              if (error === 'invalid-code' && v.length === 4) setError(null);
            }}
            invalid={Boolean(error)}
            describedBy={error ? 'join-error' : 'join-code-hint'}
          />
          <p className="field-hint" id="join-code-hint">
            Four digits, like 0047. You can paste an invite link too.
          </p>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="join-name">
            Device name <span className="faint-text">(optional)</span>
          </label>
          <input
            id="join-name"
            className="text-input"
            type="text"
            autoComplete="off"
            maxLength={32}
            placeholder="e.g. Sam’s MacBook Air"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
        </div>
      </div>
      <div aria-live="polite" id="join-error">
        {copy ? (
          <div className="join-error" data-testid="join-error">
            <AlertCircle aria-hidden="true" />
            <strong>{copy.title}</strong>
            <p>{copy.detail}</p>
          </div>
        ) : null}
      </div>
      {report && (error === 'timeout' || error === 'host-unavailable') ? <ConnectionHelp report={report} /> : null}
      <div className="join-submit">
        <Button type="submit" variant="primary" size="lg" disabled={pending || disabled} arrow={!pending}>
          {pending ? 'Looking for the room…' : 'Join room'}
        </Button>
        {pending ? (
          <span className="join-pending">
            <LoaderCircle className="spin" aria-hidden="true" />
            <button type="button" className="btn btn--quiet btn--sm" onClick={cancel}>
              Cancel
            </button>
          </span>
        ) : null}
      </div>
    </form>
  );
});
