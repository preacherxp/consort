import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { ArrowRight, ArrowUpRight, Check, ChevronDown, Heart, Loader2, RotateCcw, SlidersHorizontal, Sparkles, X, Zap } from 'lucide-react';
import { catalogMeta, findModel, models, priorities, type Effort, type Priority, type RouteResult } from '../shared/contracts';
import { saveCard } from './share-card';
import { DecisionDetails } from './DecisionDetails';
import { MatchDeck, MatchLobby } from './MatchDeck';
import { MatchStage } from './MatchStage';
import { controlSpring } from './motion';
import { readRoutingResponse } from './api-response';
import { matchCopy, type Introduction } from '../shared/matches';

const examples = [
  { label: 'A quick fix', task: 'Rename a variable and add a null check in a short TypeScript function.' },
  { label: 'A tricky bug', task: 'Debug an intermittent race condition in a distributed payment system. Events arrive out of order and occasionally charge a customer twice.' },
  { label: 'A big idea', task: 'Design a fault-tolerant architecture for a real-time collaborative editor. Think through conflict resolution, offline sync, and the tradeoffs between CRDTs and OT.' },
  { label: 'Polish an email', task: 'Rewrite a short customer email to sound clear, warm, and professional. Preserve every date, price, and commitment. Return only the revised email.' },
  { label: 'Summarize a report', task: 'Summarize a supplied 20-page research report into a one-page brief. Separate findings from assumptions, cite the relevant sections, and flag missing evidence. Use only the supplied report.' },
  { label: 'Translate UI', task: 'Translate 30 English checkout labels into natural Simplified Chinese. Preserve {name} and {amount} placeholders, keep terminology consistent, and return a JSON dictionary.' },
  { label: 'Extract data', task: 'Extract vendor names, invoice dates, currencies, and totals from short plain-text invoices. Return strict JSON matching a supplied schema, preserve exact amounts, and use null for missing fields.' },
  { label: 'Write a story', task: 'Write a 900-word literary short story with an unreliable narrator, recurring sensory imagery, and an implied twist. Prioritize distinctive prose and emotional subtlety over speed.' },
  { label: 'Analyze finances', task: 'Compare supplied financial statements from two quarters. Reconcile revenue and cash-flow changes, calculate key ratios, and explain risks with citations to the source figures. Do not use live market data.' },
  { label: 'Check a proof', task: 'Review a proposed mathematical proof for logical gaps, hidden assumptions, and invalid steps. Try to construct a counterexample before accepting the result, then suggest a rigorous repair if needed.' },
];
const placeholders = ['Debug a race condition in my payment service…', 'Turn my messy notes into a crisp email…', 'Help me design a distributed database…', 'Rename a variable. Yes, that’s the whole task.'];
const priorityLabels = { balanced: 'Task fit', speed: 'Faster', quality: 'Best quality' };
const priorityIcons = { balanced: SlidersHorizontal, speed: Zap, quality: Sparkles };
type SavedRoute = { task: string; priority: Priority; result: RouteResult };

function usePlaceholder() {
  const reduced = useReducedMotion();
  const [state, setState] = useState({ phrase: 0, length: 0, deleting: false });
  useEffect(() => {
    if (reduced) return;
    const phrase = placeholders[state.phrase];
    const atEnd = state.length === phrase.length;
    const timer = setTimeout(() => {
      if (atEnd && !state.deleting) setState({ ...state, deleting: true });
      else if (state.deleting && state.length === 0) setState({ phrase: (state.phrase + 1) % placeholders.length, length: 0, deleting: false });
      else setState({ ...state, length: state.length + (state.deleting ? -1 : 1) });
    }, atEnd && !state.deleting ? 2600 : state.deleting ? 16 : 48);
    return () => clearTimeout(timer);
  }, [state, reduced]);
  return reduced ? placeholders[0] : placeholders[state.phrase].slice(0, state.length);
}

function EffortMeter({ effort }: { effort: Effort }) {
  const filled = { low: 1, medium: 2, high: 3 }[effort];
  return <span className={`effort-badge effort-${effort}`}><span className="effort-bars" aria-hidden="true">{[1, 2, 3].map(n => <i key={n} className={n <= filled ? 'lit' : ''} />)}</span>{effort} effort</span>;
}

export function App() {
  const [task, setTask] = useState('');
  const [focused, setFocused] = useState(false);
  const [priority, setPriority] = useState<Priority>('balanced');
  const [result, setResult] = useState<RouteResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<SavedRoute[]>([]);
  const [toast, setToast] = useState('');
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [routerId, setRouterId] = useState('typesafe/jev-1.13');
  const placeholder = usePlaceholder();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/health', { signal: controller.signal }).then(r => {
      if (!r.ok) throw new Error();
      return r.json();
    }).then(data => {
      setConfigured(data.configured === true);
      if (typeof data.router === 'string') setRouterId(data.router);
    }).catch(() => {});
    return () => { controller.abort(); request.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 3000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (loading || result) {
      resultRef.current?.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'start' });
    }
  }, [loading, result, reduced]);

  function updateTask(value: string) { setTask(value); setResult(null); setError(''); }
  function cancel() {
    request.current?.abort();
    request.current = null;
    setLoading(false);
  }
  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (request.current || task.trim().length < 8) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true); setError(''); setResult(null);
    try {
      const response = await fetch('/api/route', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: task.trim(), priority }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(50000)]),
      });
      const next = await readRoutingResponse(response);
      if (request.current !== controller) return;
      setResult(next);
      setHistory(previous => [{ task: task.trim(), priority, result: next }, ...previous].slice(0, 3));
    } catch (error) {
      if (request.current !== controller || controller.signal.aborted) return;
      setError(error instanceof Error && error.name === 'TimeoutError' ? 'The request timed out. Please try again.' : error instanceof Error ? error.message : 'Couldn’t connect. Try again.');
    } finally {
      if (request.current === controller) { request.current = null; setLoading(false); }
    }
  }
  async function copyResult(selection: Introduction) {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(matchCopy(task.trim(), result, selection));
      setToast('Match copied.');
    } catch { setToast('Clipboard unavailable. Try saving the match card instead.'); }
  }
  async function exportResult(selection: Introduction) {
    if (!result) return;
    try { await saveCard(task.trim(), result, selection); setToast('Match card saved.'); }
    catch { setToast('Couldn’t save the card. Try copying your match.'); }
  }

  return <div className="app-shell">
    <header className="topbar">
      <a className="wordmark" href="/" aria-label="Consort home"><span className="brand-symbol"><Heart size={26} strokeWidth={1.8} /></span>consort<span className="wordmark-period">.</span></a>
      <button className="about-button" onClick={() => dialog.current?.showModal()}>Meet the models <ArrowUpRight size={16} /></button>
    </header>

    <main>
      <motion.section className="hero" initial={reduced ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : .3 }}>
        <h1>Meet your <span className="serif-word">model match.</span></h1>
        <p title={routerId}>Jev makes the introductions. You choose.</p>
      </motion.section>

      <motion.section className={`workspace ${result ? 'has-result' : ''}`} initial={reduced ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : .24 }} aria-label="Model recommendation tool">
        <div className="recommendation-panel" ref={resultRef} aria-busy={loading}>
          <MatchStage state={result ? 'result' : error ? 'error' : loading ? 'searching' : 'idle'}>
            {result ? <motion.div className="result-content" key={result.trace.response.id ?? result.modelId + result.elapsedMs} initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reduced ? 0 : .16 }}>
              <MatchDeck result={result} onCopy={copyResult} onSave={exportResult} />
            </motion.div> : error ? <div className="error-state"><h2>A missed connection.</h2><p role="alert">{error}</p><button onClick={() => void submit()}><RotateCcw size={16} /> Try again</button></div> : <div className="empty-state">
              <MatchLobby loading={loading} />
              {loading && <button className="cancel-button" type="button" onClick={cancel}>Cancel request <X size={14} /></button>}
            </div>}
          </MatchStage>
          <span className="sr-only" role="status">{loading ? 'Jev is preparing your introductions.' : result ? `Jev’s first pick is ${findModel(result.modelId).name}, with ${result.effort} effort.` : ''}</span>
        </div>

        <form className="task-panel" onSubmit={submit}>
          <label className="task-label" htmlFor="task">What are you working on?</label>
          <div className={`input-area ${focused ? 'is-focused' : ''}`}>
            {!task && !focused && <div className="animated-placeholder" aria-hidden="true">{placeholder}<span className="type-caret" /></div>}
            <textarea id="task" ref={textarea} value={task} disabled={loading} maxLength={4000} placeholder={focused ? 'Describe your task…' : ''} aria-describedby="task-help" onChange={event => updateTask(event.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onKeyDown={event => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void submit(); }
            }} />
            {task.length > 0 && task.trim().length < 8 && <span className="char-count">At least 8 characters</span>}
            {task.length > 3500 && <span className="char-count">{task.length.toLocaleString()} / 4,000</span>}
          </div>
          <div className="examples" role="group" aria-label="Task presets">{examples.map(example => <button type="button" disabled={loading} key={example.label} onClick={() => { updateTask(example.task); textarea.current?.focus(); }}>{example.label}</button>)}</div>
          <LayoutGroup id="routing-priority"><fieldset className="priority-selector" disabled={loading}>
            <legend className="sr-only">Routing priority</legend>
            {priorities.filter(value => value !== 'cost').map(value => {
              const Icon = priorityIcons[value];
              return <label className="priority-option" key={value}>
                <input className="sr-only" type="radio" name="priority" value={value} checked={priority === value} onChange={() => { setPriority(value); setResult(null); setError(''); }} />
                <span className="priority-content"><Icon size={16} aria-hidden="true" />{priorityLabels[value]}</span>
                {priority === value && <motion.span className="priority-highlight" aria-hidden="true" layoutId={reduced ? undefined : 'active-priority'} initial={false} transition={reduced ? { duration: 0 } : controlSpring} />}
              </label>;
            })}
          </fieldset></LayoutGroup>
          <div className="composer-actions">
            <button className={`route-button ${loading ? 'is-loading' : ''}`} type="submit" title="⌘ / Ctrl + Enter" disabled={loading || task.trim().length < 8}>{loading ? <><Loader2 className="spin" size={18} /> Introducing…</> : <>Find my match <ArrowRight size={18} /></>}</button>
          </div>
          <p id="task-help" className="privacy-note">Tasks go to OpenRouter & TypeSafe. Submitted tasks and responses are saved on our server. Don’t include secrets.</p>
        </form>
      </motion.section>

      {configured === false && <p className="config-notice" role="status">One more thing: add your OpenRouter key to <code>.env</code> and restart the server.</p>}

      {result && <details className="decision-drawer" key={result.trace.response.id ?? `${result.modelId}-${result.elapsedMs}`}><summary>Why did Jev introduce us? <ChevronDown size={16} /></summary><DecisionDetails trace={result.trace} /></details>}

      <AnimatePresence>{history.length > 0 && <motion.section className="recent-routes" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} aria-label="Recent recommendations"><details><summary>Recent introductions <ChevronDown size={16} /></summary><div className="recent-list">{history.map((saved, index) => <button disabled={loading} key={index} onClick={() => { setTask(saved.task); setPriority(saved.priority); setResult(saved.result); setError(''); }} title={saved.task}><span className="recent-number">0{history.length - index}</span><span className="recent-task">{saved.task}</span><span className="recent-model">{findModel(saved.result.modelId).name}</span><EffortMeter effort={saved.result.effort} /><ArrowUpRight size={13} /></button>)}</div></details></motion.section>}</AnimatePresence>
    </main>

    <dialog ref={dialog} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }} aria-labelledby="dialog-title">
      <div className="dialog-inner"><button className="dialog-close" aria-label="Close explanation" onClick={() => dialog.current?.close()}><X size={20} /></button><span className="eyebrow">MEET YOUR CONSORT</span><h2 id="dialog-title">Jev has good taste.<br />You have the final say.</h2><p>Jev evaluates {models.length} models, the task’s required effort, its category, and a budget option using OpenRouter’s Decisions API. The full response and supplied criteria are visible below each recommendation. The recommended model is <strong>not executed</strong>.</p><div className="logic-steps"><p><span>01</span><strong>You describe the task.</strong> Context beats a clever prompt.</p><p><span>02</span><strong>Jev makes the introductions.</strong> Your priority changes the shortlist.</p><p><span>03</span><strong>You make the match.</strong> Pass or match, then copy your pick or save a card. Swiping never calls a model.</p></div><h3>THE CANDIDATES <span>{models.length} MODELS</span></h3><p className="dialog-fineprint">{catalogMeta.policy} Catalog verified {catalogMeta.verifiedAt.slice(0, 10)}.</p><div className="catalog-list">{models.map(model => <div key={model.id}><span>{model.name}<small>{model.provider} · {model.released}{model.supersededBy ? ' · older generation' : ''}{model.preview ? ' · preview' : ''}</small></span><span>${Number(model.inputPerMillion.toFixed(3))} / ${Number(model.outputPerMillion.toFixed(3))}</span></div>)}</div><p className="dialog-fineprint">Listed USD per 1M input / output tokens, from an OpenRouter catalog snapshot. Not a task-price estimate; live rates may differ. A lower-cost alternative has lower or equal rates for both token types.</p><p className="dialog-fineprint">Recommendations are heuristic, not benchmarks. Summaries are authored from catalog descriptions and effort labels—not Jev’s private reasoning. Low / medium / high are advisory budgets; check the selected provider’s supported controls.</p><p className="dialog-fineprint">Submitted task text is sent to OpenRouter and TypeSafe. Consort stores submitted tasks, priorities, routing responses, timestamps, and sanitized error/cancellation outcomes in PostgreSQL until the operator deletes them. Unsubmitted text, keystrokes, IP addresses, cookies, and API keys are not collected by this request logger. Recent introductions in this tab stay in page memory; no browser storage is used. Upstream and hosting-provider data policies still apply. Don’t submit sensitive information.</p></div>
    </dialog>
    <AnimatePresence>{toast && <motion.div className="toast" role="status" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}><Check size={15} />{toast}</motion.div>}</AnimatePresence>
  </div>;
}
