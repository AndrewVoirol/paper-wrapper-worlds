import React, { useEffect, useRef, useState } from 'react';
import { PALETTE_PRESETS, STORY_PLATES, type StoryPlate } from './types';
import { PaperWorldEngine } from './scene/PaperWorldEngine';
import './styles.css';

function FolioWaterRule() {
  return (
    <svg
      className="folio-water-rule"
      viewBox="0 0 136 12"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <line x1="0" y1="6" x2="50" y2="6" stroke="currentColor" strokeWidth="0.85" strokeOpacity="0.45" />
      <ellipse cx="68" cy="6" rx="11" ry="3.2" stroke="currentColor" strokeWidth="0.85" strokeOpacity="0.65" />
      <circle cx="68" cy="6" r="1.4" fill="currentColor" fillOpacity="0.7" />
      <line x1="86" y1="6" x2="136" y2="6" stroke="currentColor" strokeWidth="0.85" strokeOpacity="0.45" />
    </svg>
  );
}

export function App() {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<PaperWorldEngine | null>(null);
  const cursorRingRef = useRef<HTMLDivElement | null>(null);
  const spineFillRef = useRef<HTMLDivElement | null>(null);
  const runningHeaderRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Array<HTMLElement | null>>([]);

  const [activePlateIndex, setActivePlateIndex] = useState<number>(0);
  const activeIndexRef = useRef<number>(0);
  const scrollProgressRef = useRef<number>(0);
  const programmaticProgressRef = useRef<number | null>(null);
  const programmaticTimerRef = useRef<number | null>(null);
  const lastClientHeightRef = useRef<number>(0);

  // Locked single-edition Autumn Tannin Washi paper
  const editionPalette = PALETTE_PRESETS[0];

  useEffect(() => {
    const container = viewportRef.current;
    const scroller = scrollerRef.current;
    if (!container || !scroller) return;

    const engine = new PaperWorldEngine(container, undefined, scroller);
    engineRef.current = engine;
    void engine.init();

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    lastClientHeightRef.current = scroller.clientHeight;
    let isRestoringResize = false;

    const applyProgress = (progress: number) => {
      engineRef.current?.setScrollProgress(progress, window.innerWidth < 920, false);

      if (spineFillRef.current) {
        spineFillRef.current.style.transform = `scaleY(${progress.toFixed(4)})`;
      }
      if (runningHeaderRef.current) {
        const showHeader = progress > 0.14;
        runningHeaderRef.current.classList.toggle('is-visible', showHeader);
      }

      const nextIdx = Math.min(
        STORY_PLATES.length - 1,
        Math.max(0, Math.round(progress * (STORY_PLATES.length - 1)))
      );
      if (nextIdx !== activeIndexRef.current) {
        activeIndexRef.current = nextIdx;
        setActivePlateIndex(nextIdx);
      }
    };

    const handleScroll = () => {
      const curH = scroller.clientHeight;
      if (curH < 120 || isRestoringResize) return;
      if (curH !== lastClientHeightRef.current) {
        handleResize();
        return;
      }
      const maxScroll = Math.max(1, scroller.scrollHeight - curH);
      const progress = Math.min(1, Math.max(0, scroller.scrollTop / maxScroll));
      if (programmaticProgressRef.current === null) {
        scrollProgressRef.current = progress;
      } else if (Math.abs(progress - programmaticProgressRef.current) < 0.005) {
        scrollProgressRef.current = programmaticProgressRef.current;
        programmaticProgressRef.current = null;
      }
      applyProgress(progress);
    };

    const handleResize = () => {
      const curH = scroller.clientHeight;
      if (curH < 120) return;
      lastClientHeightRef.current = curH;
      const maxScroll = Math.max(1, scroller.scrollHeight - curH);
      const targetProgress = programmaticProgressRef.current ?? scrollProgressRef.current;
      scrollProgressRef.current = targetProgress;
      programmaticProgressRef.current = null;
      isRestoringResize = true;
      scroller.scrollTop = Math.round(targetProgress * maxScroll);
      requestAnimationFrame(() => {
        isRestoringResize = false;
      });
      applyProgress(targetProgress);
    };

    const cancelProgrammaticOnWheel = () => {
      programmaticProgressRef.current = null;
    };

    handleScroll();
    scroller.addEventListener('scroll', handleScroll, { passive: true });
    scroller.addEventListener('wheel', cancelProgrammaticOnWheel, { passive: true });
    scroller.addEventListener('touchmove', cancelProgrammaticOnWheel, { passive: true });
    window.addEventListener('resize', handleResize, { passive: true });

    return () => {
      scroller.removeEventListener('scroll', handleScroll);
      scroller.removeEventListener('wheel', cancelProgrammaticOnWheel);
      scroller.removeEventListener('touchmove', cancelProgrammaticOnWheel);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const ring = cursorRingRef.current;
      if (!ring || e.pointerType === 'touch') return;
      ring.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
      const target = e.target as Element | null;
      const overTextOrControl = Boolean(
        target?.closest('button, a, .folio-passage-sheet, .prologue-folio-block, .folio-spine-nav')
      );
      ring.style.opacity = overTextOrControl ? '0' : '1';
    };

    const onPointerDown = () => {
      cursorRingRef.current?.classList.add('is-pressing');
    };

    const onPointerUp = () => {
      cursorRingRef.current?.classList.remove('is-pressing');
    };

    const onPointerOut = (e: MouseEvent) => {
      if (!e.relatedTarget && cursorRingRef.current) {
        cursorRingRef.current.style.opacity = '0';
      }
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    window.addEventListener('mouseout', onPointerOut, { passive: true });

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('mouseout', onPointerOut);
    };
  }, []);

  const scrollToPlate = (index: number) => {
    const scroller = scrollerRef.current;
    const targetEl = sectionRefs.current[index];
    const prefersReduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (scroller && targetEl && typeof scroller.scrollTo === 'function') {
      const targetProgress = index / Math.max(1, STORY_PLATES.length - 1);
      scrollProgressRef.current = targetProgress;
      programmaticProgressRef.current = targetProgress;
      if (programmaticTimerRef.current !== null) {
        window.clearTimeout(programmaticTimerRef.current);
      }
      programmaticTimerRef.current = window.setTimeout(() => {
        programmaticProgressRef.current = null;
        programmaticTimerRef.current = null;
      }, 900);
      scroller.scrollTo({
        top: targetEl.offsetTop,
        behavior: prefersReduced ? 'auto' : 'smooth',
      });
    }
    if (index === activeIndexRef.current) {
      engineRef.current?.recenterToScroll();
    }
  };

  const handleRecenter = () => {
    engineRef.current?.recenterToScroll();
  };

  const stopCanvasPointerBubble = (e: React.PointerEvent<HTMLElement>) => {
    e.stopPropagation();
  };

  const activePlate = STORY_PLATES[activePlateIndex] ?? STORY_PLATES[0];

  return (
    <div
      className="paper-folio-page"
      style={{ '--paper-bg': editionPalette.paperBgHex } as React.CSSProperties}
    >
      {/* Static Full-Sheet WebGPU Diorama Stage */}
      <div
        ref={viewportRef}
        className="paper-world-viewport"
        aria-label="Interactive Three-Dimensional Paper and Watercolor Diorama of Little Nis at Holly Pond in Bernheim Forest, Kentucky"
      />

      {/* Organic Watercolor Fluid Brush Tip (Canvas-only, hidden on prose & controls) */}
      <div ref={cursorRingRef} className="watercolor-brush-cursor" aria-hidden="true">
        <span className="watercolor-brush-dot" />
      </div>

      {/* Archival Bookplate Neatline & Running Marginalia */}
      <div className="folio-sheet-frame" aria-hidden="true">
        <div ref={runningHeaderRef} className="folio-running-header">
          <div className="running-title-pair label-en">
            <span className="running-subject">LITTLE NIS</span>
            <span className="folio-interpunct">·</span>
            <span>BERNHEIM FOREST, KY</span>
          </div>
          <span className="label-en running-plate-caption">{activePlate.runningCaption}</span>
        </div>
      </div>

      {/* Quiet Right-Margin Folio Spine Numerals */}
      <nav className="folio-spine-nav" aria-label="Bernheim Trail Stops">
        <div className="spine-rail" aria-hidden="true">
          <div ref={spineFillRef} className="spine-rail-fill" />
        </div>
        {STORY_PLATES.map((plate: StoryPlate, idx: number) => {
          const isCurrent = idx === activePlateIndex;
          return (
            <button
              key={plate.id}
              type="button"
              className={`spine-stop-btn ${isCurrent ? 'is-active' : ''}`}
              onClick={() => scrollToPlate(idx)}
              aria-label={`${plate.folioLabel} — ${plate.title}`}
              aria-current={isCurrent ? 'step' : undefined}
            >
              <span className="spine-stop-tooltip">{plate.title}</span>
              <span className="spine-stop-numeral">
                {plate.numeral === '0' ? '§' : plate.numeral}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Dedicated Full-Viewport Scroller & Interactive Diorama Surface */}
      <div ref={scrollerRef} className="storybook-scroller">
        <main className="storybook-scroll-track">
          {STORY_PLATES.map((plate: StoryPlate, idx: number) => {
            const isPrologue = idx === 0;
            const isFinalPlate = idx === STORY_PLATES.length - 1;

            return (
              <section
                key={plate.id}
                id={plate.id}
                ref={(el) => {
                  sectionRefs.current[idx] = el;
                }}
                className={`story-stage ${isPrologue ? 'story-stage--prologue' : ''}`}
              >
                {isPrologue ? (
                  <header
                    className="prologue-folio-block"
                    onPointerDown={stopCanvasPointerBubble}
                  >
                    <div className="prologue-epigraph-row">
                      <span className="trail-stamp label-en">HOLLY POND</span>
                      <span className="prologue-rubric label-en">
                        BERNHEIM FOREST
                        <span className="folio-interpunct">·</span>
                        EST. 2019
                      </span>
                    </div>

                    <h1 className="prologue-title">{plate.title}</h1>
                    {plate.subtitle && <p className="prologue-subtitle">{plate.subtitle}</p>}

                    <FolioWaterRule />

                    <p className="prologue-lede">{plate.body}</p>

                    <p className="prologue-whisper label-en">{plate.whisperCue}</p>

                    <button
                      type="button"
                      className="prologue-begin-link label-en"
                      onClick={() => scrollToPlate(1)}
                    >
                      <span>Walk the Trail — Plate I</span>
                      <span className="begin-rule" aria-hidden="true" />
                    </button>
                  </header>
                ) : (
                  <article
                    className="folio-passage-sheet"
                    onPointerDown={stopCanvasPointerBubble}
                  >
                    <div className="passage-accent-bar" aria-hidden="true" />
                    <div className="passage-meta-row label-en">
                      <span className="passage-folio-label">{plate.folioLabel}</span>
                      {plate.plateCounter && (
                        <span className="passage-counter">{plate.plateCounter}</span>
                      )}
                    </div>

                    <h2 className="passage-title">{plate.title}</h2>

                    <p className="passage-body">{plate.body}</p>

                    <div className="passage-whisper-row">
                      <span className="passage-whisper">{plate.whisperCue}</span>
                    </div>

                    {isFinalPlate && (
                      <footer className="colophon-footer">
                        <p className="colophon-provenance">
                          After Thomas Dambo’s “Little Nis” (2019) · Bernheim Arboretum &amp;
                          Research Forest, Clermont, Kentucky
                        </p>

                        <div
                          className="colophon-plates-row"
                          role="group"
                          aria-label="Return to Trail Stop"
                        >
                          {STORY_PLATES.slice(1).map((p, subIdx) => {
                            const targetIdx = subIdx + 1;
                            return (
                              <button
                                key={p.id}
                                type="button"
                                className={`colophon-plate-link ${
                                  activePlateIndex === targetIdx ? 'is-active' : ''
                                }`}
                                onClick={() => scrollToPlate(targetIdx)}
                              >
                                <span className="colophon-roman">{p.numeral}.</span>
                                <span className="label-en">{p.shortStopLabel}</span>
                              </button>
                            );
                          })}
                        </div>

                        <div className="colophon-actions-row">
                          <button
                            type="button"
                            className="colophon-utility-link label-en"
                            onClick={handleRecenter}
                          >
                            Settle Holly Pond
                          </button>
                          <span className="folio-interpunct" aria-hidden="true">
                            ·
                          </span>
                          <button
                            type="button"
                            className="colophon-utility-link label-en"
                            onClick={() => scrollToPlate(0)}
                          >
                            Back to Trailhead
                          </button>
                        </div>
                      </footer>
                    )}
                  </article>
                )}
              </section>
            );
          })}
        </main>
      </div>
    </div>
  );
}

export default App;
