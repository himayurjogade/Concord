import { useEffect, useRef } from 'react';

// turns a whole-textarea change into one positioned operation
export function diffToOp(oldText, newText) {
  if (oldText === newText) return null;

  let start = 0;
  while (start < oldText.length && start < newText.length && oldText[start] === newText[start]) {
    start++;
  }

  let endOld = oldText.length;
  let endNew = newText.length;
  while (endOld > start && endNew > start && oldText[endOld - 1] === newText[endNew - 1]) {
    endOld--;
    endNew--;
  }

  const removed = endOld - start;
  const inserted = newText.slice(start, endNew);

  if (removed > 0 && inserted.length === 0) return { type: 'delete', pos: start, len: removed };
  if (removed === 0 && inserted.length > 0) return { type: 'insert', pos: start, text: inserted };
  return { type: 'replace', pos: start, len: removed, text: inserted };
}

export default function Editor({ text, onEdit, onCursor, offline, setOffline, connected, myId }) {
  const ref = useRef(null);
  const lastText = useRef(text);
  lastText.current = text;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => onCursor(el.selectionStart);
    document.addEventListener('selectionchange', report);
    return () => document.removeEventListener('selectionchange', report);
  }, [onCursor]);

  const handleChange = (event) => {
    const op = diffToOp(lastText.current, event.target.value);
    if (op) onEdit(op, event.target.value);
  };

  return (
    <div className="panel">
      <div className="between">
        <div>
          <h2>Editor</h2>
          <p className="sub">
            you are <code>{myId || '...'}</code>{' '}
            <span style={{ color: connected ? 'var(--ok)' : 'var(--bad)' }}>
              {connected ? 'connected' : 'disconnected'}
            </span>
          </p>
        </div>

        <label className="check">
          <input type="checkbox" checked={offline} onChange={(e) => setOffline(e.target.checked)} />
          <span style={{ color: offline ? 'var(--warn)' : 'var(--dim)' }}>
            {offline ? 'partitioned, edits queued' : 'simulate network partition'}
          </span>
        </label>
      </div>

      <textarea
        ref={ref}
        value={text}
        onChange={handleChange}
        spellCheck={false}
        placeholder="start typing, open this page in a second tab to collaborate"
      />
    </div>
  );
}
