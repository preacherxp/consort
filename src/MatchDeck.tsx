import { useMemo, useState } from 'react';
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { ArrowDownToLine, Asterisk, Copy, Cpu, Heart, RotateCcw, Sparkles, X } from 'lucide-react';
import { findModel, type RouteResult } from '../shared/contracts';
import { getIntroductions, introductionLabel, type Introduction } from '../shared/matches';
import { surfaceSpring } from './motion';

function Profile({ introduction, result, matched, index, total, onSwipe }: {
  introduction: Introduction; result: RouteResult; matched: boolean; index: number; total: number; onSwipe: (direction: number) => void;
}) {
  const model = findModel(introduction.modelId);
  const reduced = useReducedMotion();
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-12, 12]);
  const likeOpacity = useTransform(x, [25, 110], [0, 1]);
  const passOpacity = useTransform(x, [-110, -25], [1, 0]);
  const Icon = model.provider === 'Anthropic' ? Asterisk : model.provider === 'Google' ? Sparkles : Cpu;
  const context = model.context >= 1e6 ? `${+(model.context / 1e6).toFixed(1)}M` : `${Math.round(model.context / 1000)}k`;
  return <motion.article
    className={`model-profile ${matched ? 'is-matched' : ''}`}
    aria-label={`${model.name} profile`}
    style={{ x, rotate: reduced ? 0 : rotate, touchAction: 'pan-y' }}
    drag={matched ? false : 'x'} dragConstraints={{ left: 0, right: 0 }} dragElastic={.8}
    onDragEnd={(_event, info) => {
      if (Math.abs(info.offset.x) > 90 || Math.abs(info.velocity.x) > 650) {
        const intent = Math.abs(info.offset.x) > 90 ? info.offset.x : info.velocity.x;
        onSwipe(intent > 0 ? 1 : -1);
      }
    }}
    whileTap={matched ? undefined : { cursor: 'grabbing' }}
  >
    <div className="profile-topline"><span><Sparkles size={14} /> {introductionLabel(introduction)}</span><span>{String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}</span></div>
    <div aria-hidden="true"><motion.span className="swipe-stamp stamp-like" style={{ opacity: likeOpacity }}>MATCH</motion.span><motion.span className="swipe-stamp stamp-pass" style={{ opacity: passOpacity }}>PASS</motion.span></div>
    <div className="profile-bio">
      <div className="profile-provider"><span><Icon size={20} />{model.provider}</span>{(model.preview || model.supersededBy) && <span>{model.preview ? 'Preview' : 'Older generation'}</span>}</div>
      {matched && <motion.div className="match-celebration" initial={reduced ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={reduced ? { duration: 0 } : surfaceSpring}><Heart size={16} fill="currentColor" /><span>it’s a match!</span></motion.div>}
      <h2>{model.name}</h2>
      <div className="profile-traits"><span><i className={`thinking-dots dots-${result.effort}`} aria-hidden="true"><b /><b /><b /></i>{result.effort} effort</span><span>{context} context</span><span>{result.taskType}</span></div>
      <p>{model.strengths.split(/(?<=[.!?])\s+/)[0]}</p>
    </div>
  </motion.article>;
}

export function MatchLobby({ loading }: { loading: boolean }) {
  return <div className={`match-lobby ${loading ? 'lobby-loading' : ''}`}>
    <div className={`lobby-graphic ${loading ? 'match-search' : ''}`} aria-hidden="true">
      {loading && <span className="search-halo" />}
      <span className="search-card search-card-left">{loading && <Cpu size={18} />}</span>
      <span className="search-card search-card-right">{loading && <Sparkles size={18} />}</span>
      <span className="search-card search-card-front">{loading ? <Heart className="search-heart" size={22} fill="currentColor" /> : <span className="jev-initial">j.</span>}</span>
      {loading && <><span className="search-spark search-spark-one" /><span className="search-spark search-spark-two" /></>}
    </div>
    <div className="lobby-copy"><h2>{loading ? 'Jev is finding your match…' : 'Your next match starts here.'}</h2><p>{loading ? 'Choosing a model and the right effort.' : 'Describe your task below.'}</p></div>
  </div>;
}

export function MatchDeck({ result, onCopy, onSave }: {
  result: RouteResult; onCopy: (selection: Introduction) => void; onSave: (selection: Introduction) => void;
}) {
  const introductions = useMemo(() => getIntroductions(result), [result]);
  const [index, setIndex] = useState(0);
  const [matched, setMatched] = useState(false);
  const [direction, setDirection] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const reduced = useReducedMotion();
  const current = introductions[index];
  function move(next: number, like = false) {
    if (transitioning) return;
    if (like) {
      // The selected card stays in place; only its state and actions change.
      setMatched(true);
      return;
    }
    setDirection(next > index ? -1 : 1);
    setTransitioning(true);
    setMatched(false);
    setIndex(next);
  }
  function swipe(direction: number) {
    if (matched || transitioning) return;
    if (direction > 0) move(index, true);
    else move(index + 1);
  }

  return <div className="match-deck">
    <div className="deck-caption"><span>{matched ? 'Your match' : 'Your introductions'}</span><span>{(result.elapsedMs / 1000).toFixed(2)}s to match</span></div>
    <div className="profile-stack">
      {current && <div className="stack-sheet" aria-hidden="true" />}
      <AnimatePresence mode="wait" custom={direction} onExitComplete={() => setTransitioning(false)}>
        {current ? <motion.div className="profile-wrap" key={index} custom={direction}
          initial={reduced ? false : { opacity: 0, x: -direction * 32, y: direction === 0 ? 8 : 0 }} animate={{ opacity: 1, x: 0, y: 0 }}
          variants={{ leave: (direction: number) => reduced ? { opacity: 0 } : { x: direction * 120, rotate: direction * 5, opacity: 0, transition: { duration: .14, ease: 'easeOut' } } }} exit="leave"
          transition={reduced ? { duration: 0 } : surfaceSpring}
        ><Profile introduction={current} result={result} matched={matched} index={index} total={introductions.length} onSwipe={swipe} /></motion.div>
        : <motion.div className="deck-empty" key="finished" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : .14 }}><h2>No more introductions.</h2><p>Revisit the shortlist or try another task.</p><button onClick={() => move(0)}><RotateCcw size={17} /> Meet them again</button></motion.div>}
      </AnimatePresence>
    </div>
    {current && <>
      {matched ? <div className="matched-actions"><button onClick={() => onCopy(current)}><Copy size={18} /> Copy my match</button><button onClick={() => onSave(current)}><ArrowDownToLine size={18} /> Save match card</button><button className="keep-browsing" onClick={() => { setDirection(0); setMatched(false); }}><RotateCcw size={15} /> Keep browsing</button></div>
      : <div className="swipe-actions"><button className="undo-profile" disabled={index === 0 || transitioning} aria-label="Previous model" onClick={() => move(index - 1)}><RotateCcw size={21} /></button><button className="pass-profile" disabled={transitioning} onClick={() => swipe(-1)}><X size={24} /><span>Pass</span></button><button className="like-profile" disabled={transitioning} onClick={() => swipe(1)}><Heart size={24} /><span>Match</span></button></div>}
      <p className="swipe-help">{matched ? `${findModel(current.modelId).name} is your pick. Nothing has been sent to it.` : 'Swipe or use the buttons to choose.'}</p>
    </>}
    <p className="sr-only" role="status">{matched && current ? `It’s a match with ${findModel(current.modelId).name}.` : current ? `Meeting ${findModel(current.modelId).name}, ${index + 1} of ${introductions.length}.` : 'End of Jev’s shortlist.'}</p>
  </div>;
}
