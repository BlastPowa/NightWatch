import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { AppView } from '@/components/AppShell';
import { Icon, type IconName } from '@/components/Icon';

export const ONBOARDING_STORAGE_KEY = 'nightwatch:onboarding:v1';
const ONBOARDING_EVENT = 'nightwatch:start-onboarding';

type TourState = 'complete' | 'skipped';

interface OnboardingTourProps {
  includeLibrary: boolean;
  currentView: AppView;
  onNavigate(view: AppView): void;
}

interface TourStep {
  title: string;
  description: string;
  icon: IconName;
  target?: string;
  view?: AppView;
}

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function startOnboardingTour(): void {
  window.dispatchEvent(new Event(ONBOARDING_EVENT));
}

export function OnboardingTour({
  includeLibrary,
  currentView,
  onNavigate,
}: OnboardingTourProps): JSX.Element | null {
  const steps = useMemo(() => buildSteps(includeLibrary), [includeLibrary]);
  const [open, setOpen] = useState(() => readTourState() === null);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const step = steps[Math.min(stepIndex, steps.length - 1)]!;

  useEffect(() => {
    const restart = (): void => {
      setStepIndex(0);
      setOpen(true);
    };
    window.addEventListener(ONBOARDING_EVENT, restart);
    return () => window.removeEventListener(ONBOARDING_EVENT, restart);
  }, []);

  useEffect(() => {
    if (!open || step.view === undefined || step.view === currentView) return;
    onNavigate(step.view);
  }, [currentView, onNavigate, open, step.view]);

  useEffect(() => {
    if (!open || step.target === undefined) {
      setTargetRect(null);
      return;
    }

    let frame = 0;
    const update = (): void => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const target = document.querySelector<HTMLElement>(step.target ?? '');
        if (target === null) {
          setTargetRect(null);
          return;
        }
        target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        const rect = target.getBoundingClientRect();
        setTargetRect({
          top: Math.max(8, rect.top - 6),
          left: Math.max(8, rect.left - 6),
          width: Math.max(28, rect.width + 12),
          height: Math.max(28, rect.height + 12),
        });
      });
    };

    update();
    const delayed = window.setTimeout(update, 120);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.clearTimeout(delayed);
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [currentView, open, step.target]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') skip();
      if (event.key === 'ArrowRight') next();
      if (event.key === 'ArrowLeft') previous();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (!open) return null;

  const isLast = stepIndex === steps.length - 1;
  const spotlightStyle = targetRect === null
    ? undefined
    : {
        '--tour-top': `${targetRect.top}px`,
        '--tour-left': `${targetRect.left}px`,
        '--tour-width': `${targetRect.width}px`,
        '--tour-height': `${targetRect.height}px`,
      } as CSSProperties;

  function finish(): void {
    writeTourState('complete');
    setOpen(false);
  }

  function skip(): void {
    writeTourState('skipped');
    setOpen(false);
  }

  function next(): void {
    if (isLast) {
      finish();
      return;
    }
    setStepIndex((current) => Math.min(current + 1, steps.length - 1));
  }

  function previous(): void {
    setStepIndex((current) => Math.max(0, current - 1));
  }

  return (
    <div className="onboarding-layer" role="presentation" style={spotlightStyle}>
      <div className={`onboarding-scrim${targetRect === null ? ' onboarding-scrim-full' : ''}`} />
      {targetRect !== null && <div className="onboarding-spotlight" aria-hidden="true" />}
      <section
        className={`onboarding-card${targetRect === null ? ' onboarding-card-centered' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        aria-describedby="onboarding-description"
      >
        <header className="onboarding-card-header">
          <span className="onboarding-step-icon"><Icon name={step.icon} size={20} /></span>
          <span className="onboarding-count">{stepIndex + 1} / {steps.length}</span>
        </header>
        <h2 id="onboarding-title">{step.title}</h2>
        <p id="onboarding-description">{step.description}</p>
        <div className="onboarding-progress" aria-hidden="true">
          {steps.map((candidate, index) => (
            <span
              key={candidate.title}
              className={index <= stepIndex ? 'onboarding-progress-active' : undefined}
            />
          ))}
        </div>
        <footer className="onboarding-actions">
          <button type="button" className="button button-quiet" onClick={skip}>
            <Icon name="close" size={15} />
            Skip tour
          </button>
          <div>
            {stepIndex > 0 && (
              <button type="button" className="button button-quiet" onClick={previous}>
                <Icon name="chevron-left" size={15} />
                Back
              </button>
            )}
            <button type="button" className="button button-primary" onClick={next}>
              {isLast ? <Icon name="check" size={15} /> : null}
              {isLast ? 'Finish' : 'Next'}
              {!isLast ? <Icon name="chevron-right" size={15} /> : null}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function buildSteps(includeLibrary: boolean): TourStep[] {
  return [
    {
      title: 'Welcome to NightWatch',
      description: 'Take a quick tour of the controls used to browse, host, personalize, and play authorized media. You can skip now and restart from FAQ at any time.',
      icon: 'sparkle',
      view: 'discover',
    },
    {
      title: 'Browse together',
      description: 'Discover videos, switch categories, revisit history, and see consent-safe friend activity when that feature is available.',
      icon: 'compass',
      target: '[data-tour="nav-discover"]',
      view: 'discover',
    },
    {
      title: 'Search the whole catalog',
      description: 'Search videos, creators, and topics from every screen. Results open in Browse without interrupting an active room.',
      icon: 'search',
      target: '[data-tour="search"]',
      view: 'discover',
    },
    {
      title: 'Open the watch room',
      description: 'Create or join a synchronized room. The official YouTube player remains mounted when you browse through the mini-player.',
      icon: 'play',
      target: '[data-tour="room"]',
      view: 'main',
    },
    ...(includeLibrary
      ? [{
          title: 'Play media you own',
          description: 'Library supports authorized local files and selected Google Drive files. Paths and encrypted tokens stay on your device.',
          icon: 'library' as IconName,
          target: '[data-tour="nav-library"]',
          view: 'library' as AppView,
        }]
      : []),
    {
      title: 'Make NightWatch yours',
      description: 'Choose an atmosphere, accent, backdrop, card treatment, accessibility options, captions, previews, and mini-player behavior.',
      icon: 'settings',
      target: '[data-tour="nav-settings"]',
      view: 'settings',
    },
    {
      title: 'Answers are always nearby',
      description: 'FAQ explains rooms, privacy, Google Drive permissions, captions, messaging, troubleshooting, and feature limits.',
      icon: 'help',
      target: '[data-tour="nav-faq"]',
      view: 'faq',
    },
    {
      title: 'Your NightWatch identity',
      description: 'Open your profile to see achievements, viewing stats, and the profile border you have selected.',
      icon: 'profile',
      target: '[data-tour="profile"]',
      view: 'card',
    },
  ];
}

function readTourState(): TourState | null {
  try {
    const value = window.localStorage.getItem(ONBOARDING_STORAGE_KEY);
    return value === 'complete' || value === 'skipped' ? value : null;
  } catch {
    return null;
  }
}

function writeTourState(value: TourState): void {
  try {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, value);
  } catch {
    // Storage may be unavailable in privacy-restricted browser fallbacks.
  }
}
