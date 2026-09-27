import { useEffect, useLayoutEffect, useRef } from 'react';

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

// where a caret at p ends up after op is applied before it
export function shiftPos(p, op) {
  const len = op.len || 0;
  const ins = op.text ? op.text.length : 0;
  if (p <= op.pos) return p;
  if (p >= op.pos + len) return p + ins - len;
  return op.pos + ins; // caret was inside deleted text
}

export default function Editor({ text, onEdit, onCursor, offline, setOffline, connected, myId }) {
  const ref = useRef(null);
  const lastText = useRef(text);
  lastText.current = text;
  const shownText = useRef(text);
  const typedText = useRef(null);
  const selection = useRef([0, 0]);

  // a remote edit replaces the value and the browser jumps the caret to the end, put it back
  useLayoutEffect(() => {
    const el = ref.current;
    const prev = shownText.current;
    shownText.current = text;
    const typed = text === typedText.current;
    typedText.current = null;
    if (!el || typed) return;
    const op = diffToOp(prev, text);
    if (!op || document.activeElement !== el) return;
    el.setSelectionRange(shiftPos(selection.current[0], op), shiftPos(selection.current[1], op));
  }, [text]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // selectionchange fires async, so this still holds the pre-edit caret when the layout effect runs
    const report = () => {
      if (document.activeElement !== el) return;
      selection.current = [el.selectionStart, el.selectionEnd];
      onCursor(el.selectionStart);
    };
    document.addEventListener('selectionchange', report);
    return () => document.removeEventListener('selectionchange', report);
  }, [onCursor]);

  const handleChange = (event) => {
    typedText.current = event.target.value;
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
