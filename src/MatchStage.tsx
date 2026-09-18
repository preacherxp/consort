import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { surfaceSpring } from './motion';

/** Resize the persistent surface, never scale its text or the swipe coordinate space. */
export function MatchStage({ state, children }: {
  state: 'idle' | 'searching' | 'result' | 'error'; children: ReactNode;
}) {
  const content = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    const element = content.current;
    if (!element) return;
    const measure = () => setHeight(element.offsetHeight + 2); // persistent 1px border
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return <motion.div className="match-stage" data-state={state} initial={false}
    animate={height === undefined ? undefined : { height }}
    // Clearing a result while typing, cancelling, and reduced-motion changes are immediate.
    transition={reduced || state === 'idle' || state === 'error' ? { duration: 0 } : surfaceSpring}
  ><div className="stage-content" ref={content}>{children}</div></motion.div>;
}
