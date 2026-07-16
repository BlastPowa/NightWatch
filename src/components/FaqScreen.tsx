import { useMemo, useState } from 'react';
import { Icon, type IconName } from '@/components/Icon';
import { startOnboardingTour } from '@/components/OnboardingTour';

type FaqCategory =
  | 'Getting started'
  | 'Watch rooms'
  | 'Browse & player'
  | 'Library & Drive'
  | 'Social & privacy'
  | 'Troubleshooting';

interface FaqItem {
  category: FaqCategory;
  question: string;
  answer: string;
}

const FAQS: readonly FaqItem[] = [
  {
    category: 'Getting started',
    question: 'How do I learn where everything is?',
    answer: 'NightWatch shows a short guided tour on first launch. It highlights the real navigation, search, room, Library, Settings, FAQ, and Profile controls. You can skip it and restart it from this page whenever you want.',
  },
  {
    category: 'Getting started',
    question: 'Do my appearance and accessibility settings follow me?',
    answer: 'Settings are stored locally under the existing NightWatch settings key. Signed-in cloud synchronization may copy supported preferences, while device-specific media paths and Google tokens always remain on that device.',
  },
  {
    category: 'Watch rooms',
    question: 'How does synchronized playback work?',
    answer: 'The host controls play, pause, seek, and queue state. NightWatch synchronizes player state and corrects drift; it does not proxy or restream YouTube video data.',
  },
  {
    category: 'Watch rooms',
    question: 'Why does the player stay visible while I browse?',
    answer: 'When a room has loaded media, the same mounted player becomes a mini-player on other screens. This preserves playback and synchronization instead of creating a second player or reloading the video.',
  },
  {
    category: 'Browse & player',
    question: 'Are hover previews muted?',
    answer: 'Yes. Desktop hover previews use one official YouTube iframe at a time and start muted to respect browser autoplay rules. They are disabled for touch layouts, reduced motion, unavailable embeds, and when you turn previews off in Settings.',
  },
  {
    category: 'Browse & player',
    question: 'Does NightWatch create automatic subtitles?',
    answer: 'No speech-to-text is generated. Prefer captions asks the official YouTube player to load a caption track supplied by YouTube in your selected language when one is available.',
  },
  {
    category: 'Library & Drive',
    question: 'What can I play from Library?',
    answer: 'The current desktop Library accepts authorized MP4 and WebM files from your computer and files you explicitly choose from Google Drive. Codec support depends on the device. Discord Activity remains YouTube-only.',
  },
  {
    category: 'Library & Drive',
    question: 'What access does Google Drive receive?',
    answer: 'Sign-in opens in the system browser and uses the narrow drive.file permission. Google Picker grants NightWatch access only to files you select. Refresh tokens are encrypted locally with Electron safeStorage and are never stored in Supabase or room events.',
  },
  {
    category: 'Library & Drive',
    question: 'Can other people watch my Drive file automatically?',
    answer: 'No. Each participant must independently own or have permission to the same Drive file. NightWatch synchronizes state only; it never relays the movie bytes through Supabase or the host.',
  },
  {
    category: 'Library & Drive',
    question: 'What does connecting a YouTube account do?',
    answer: 'The optional desktop connection requests read-only YouTube access for account-owned discovery. It uses separate consent and encrypted local credentials from Drive, and it never signs into, customizes, or replaces the official embedded player.',
  },
  {
    category: 'Library & Drive',
    question: 'Can NightWatch download from YouTube or streaming services?',
    answer: 'No. NightWatch does not download YouTube, Netflix, Amazon Prime, Crunchyroll, or DRM-protected content, bypass copy protection, or provide a shared pirated catalog. Use files you are authorized to access.',
  },
  {
    category: 'Social & privacy',
    question: 'What can friends see about me?',
    answer: 'Presence sharing is consent-based and never exposes private room codes. Accepted friends may see the safe activity details you permit. Blocking prevents invitations, messages, presence access, and friends-only moment notes.',
  },
  {
    category: 'Social & privacy',
    question: 'Are messages end-to-end encrypted?',
    answer: 'No. Messages are persistent and protected by Supabase membership rules and row-level security, but NightWatch does not claim end-to-end encryption.',
  },
  {
    category: 'Troubleshooting',
    question: 'Why is Google Drive unavailable?',
    answer: 'The packaged build needs the owner-controlled Drive flag plus a desktop OAuth client ID, restricted Picker API key, and Google app ID. The Library page shows whether Drive is disabled or configuration is incomplete without revealing credential values.',
  },
  {
    category: 'Troubleshooting',
    question: 'Why does Google show Error 403 or Access blocked?',
    answer: 'The Google OAuth app is usually still in Testing and the selected account is not approved. The NightWatch owner must open Google Auth Platform, choose Audience, add that exact Google address under Test users, save, and retry. For general public access, the owner must complete Google verification where required and publish the OAuth app to Production. Changing NightWatch scopes or sharing credentials is not a fix.',
  },
  {
    category: 'Troubleshooting',
    question: 'Why will a local or Drive video not play?',
    answer: 'The file may use an unsupported codec, exceed the owner size limit, no longer be accessible, or have a mismatched fingerprint. Start with MP4 H.264/AAC or WebM VP8/VP9/Opus and confirm every participant has access.',
  },
];

const CATEGORY_ICONS: Record<FaqCategory, IconName> = {
  'Getting started': 'sparkle',
  'Watch rooms': 'play',
  'Browse & player': 'compass',
  'Library & Drive': 'cloud',
  'Social & privacy': 'shield',
  Troubleshooting: 'tools',
};

export function FaqScreen(): JSX.Element {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<FaqCategory | 'All'>('All');

  const results = useMemo(() => {
    const clean = query.trim().toLocaleLowerCase();
    return FAQS.filter((item) => {
      const categoryMatches = category === 'All' || item.category === category;
      const queryMatches =
        clean === '' ||
        item.question.toLocaleLowerCase().includes(clean) ||
        item.answer.toLocaleLowerCase().includes(clean);
      return categoryMatches && queryMatches;
    });
  }, [category, query]);

  return (
    <section className="faq-page fade-up">
      <header className="faq-hero">
        <div>
          <span className="eyebrow">NightWatch guide</span>
          <h1>How can we help?</h1>
          <p>Clear answers about watch rooms, media permissions, privacy, captions, and the controls throughout the app.</p>
        </div>
        <button type="button" className="button button-primary faq-tour-button" onClick={startOnboardingTour}>
          <Icon name="compass" />
          Start guided tour
        </button>
      </header>

      <label className="faq-search">
        <Icon name="search" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search how NightWatch works"
        />
        {query !== '' && (
          <button type="button" onClick={() => setQuery('')} aria-label="Clear FAQ search">
            <Icon name="close" size={15} />
          </button>
        )}
      </label>

      <div className="faq-categories" role="group" aria-label="FAQ categories">
        <button type="button" className={category === 'All' ? 'is-active' : undefined} onClick={() => setCategory('All')}>
          <Icon name="help" size={16} />
          All
        </button>
        {(Object.keys(CATEGORY_ICONS) as FaqCategory[]).map((name) => (
          <button type="button" key={name} className={category === name ? 'is-active' : undefined} onClick={() => setCategory(name)}>
            <Icon name={CATEGORY_ICONS[name]} size={16} />
            {name}
          </button>
        ))}
      </div>

      <div className="faq-results" aria-live="polite">
        <div className="faq-results-heading">
          <div>
            <span className="eyebrow">{category === 'All' ? 'All topics' : category}</span>
            <h2>{results.length} {results.length === 1 ? 'answer' : 'answers'}</h2>
          </div>
          <span>Nothing here changes your account or media permissions.</span>
        </div>
        {results.length === 0 ? (
          <div className="faq-empty">
            <Icon name="search" size={28} />
            <h2>No matching answer</h2>
            <p>Try a broader phrase or select All topics.</p>
            <button type="button" className="button" onClick={() => { setQuery(''); setCategory('All'); }}>
              <Icon name="close" size={15} />
              Clear filters
            </button>
          </div>
        ) : (
          <div className="faq-list">
            {results.map((item) => (
              <details key={item.question} className="faq-item">
                <summary>
                  <span className="faq-item-icon"><Icon name={CATEGORY_ICONS[item.category]} size={18} /></span>
                  <span><small>{item.category}</small>{item.question}</span>
                  <Icon name="chevron-right" className="faq-chevron" size={18} />
                </summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
