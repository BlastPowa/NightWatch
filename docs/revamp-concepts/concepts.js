const pages = [
  ['Watch', 'discover', '⌂', 'Browse'],
  ['Watch', 'lobby', '＋', 'Watch lobby'],
  ['Watch', 'room', '▶', 'Active room'],
  ['Watch', 'rooms', '◫', 'Parties'],
  ['Social', 'friends', '◎', 'Friends'],
  ['Social', 'messages', '✦', 'Messages'],
  ['Social', 'creator', '◇', 'Creator Club'],
  ['Collection', 'library', '▣', 'Library'],
  ['You', 'profile', '◉', 'Profile'],
  ['You', 'settings', '⚙', 'Settings'],
  ['You', 'faq', '?', 'FAQ'],
  ['You', 'about', 'i', 'About'],
];

const stage = document.querySelector('#concept-stage');
const nav = document.querySelector('#concept-nav');
const pageName = document.querySelector('#page-name');

function buttons(primary, secondary = '') {
  return `<div class="page-actions"><button class="primary-button">${primary}</button>${secondary ? `<button class="ghost-button">${secondary}</button>` : ''}</div>`;
}

function heading(kicker, title, copy, primary, secondary = '') {
  return `<header class="page-heading"><div class="page-heading-copy"><span class="eyebrow">${kicker}</span><h1>${title}</h1><p>${copy}</p></div>${buttons(primary, secondary)}</header>`;
}

function mediaCard(title, meta, progress = '') {
  return `<article class="media-card"><strong>${title}</strong><small>${meta}</small>${progress ? `<div class="progress" style="--p:${progress}"><span></span></div>` : ''}</article>`;
}

function listRow(title, meta, status = 'Ready') {
  return `<div class="list-row"><span class="mini-cover"></span><span class="list-copy"><strong>${title}</strong><small>${meta}</small></span><span class="status">${status}</span></div>`;
}

const concepts = {
  discover: () => `
    ${heading('Browse', 'Pick the vibe. NightWatch handles the sync.', 'A cinematic discovery home that feels like the front door to the whole product: one hero, resume-first media, then fast category rails.', 'Start a room', 'My library')}
    <section class="glass spotlight"><div class="spotlight-copy"><span class="eyebrow">Tonight’s spotlight</span><h2>Watch together without the countdown.</h2><p>Open a synchronized room, invite friends, then browse YouTube, your authorized library, or recent room history without losing the session.</p><div class="meta-row"><span class="pill accent">Live sync</span><span class="pill">Shared queue</span><span class="pill">Voice optional</span></div>${buttons('Watch now', 'Quick look')}</div></section>
    <section><div class="section-title"><h2>Continue watching</h2><small>Across your recent rooms</small></div><div class="rail">${mediaCard('The last episode', 'Room: Friday Crew', '68%')}${mediaCard('Night drive mix', 'YouTube · 42 min', '31%')}${mediaCard('Indie film night', 'Local media', '84%')}${mediaCard('Creator premiere', 'Starts 21:00')}</div></section>
    <section><div class="section-title"><h2>Popular with your circle</h2><small>Friend activity + trending</small></div><div class="grid-4">${mediaCard('Deep Space Live', '12 friends watching')}${mediaCard('Studio Sessions', 'Music · Trending')}${mediaCard('Game Awards', 'Gaming · 2h')}${mediaCard('NightWatch Picks', 'Because you watched…')}</div></section>`,

  lobby: () => `
    ${heading('Watch', 'One room. Everyone on the same frame.', 'The lobby becomes a focused two-column launch surface instead of a form floating in empty space.', 'Create room', 'Paste invite')}
    <div class="grid-2"><section class="glass spotlight"><div class="spotlight-copy"><span class="eyebrow">Private by default</span><h2>Tonight is better together.</h2><p>Invite people with a short code or deep link. Play, pause, seeks, queue votes and reactions stay synchronized.</p><div class="chip-row"><span class="pill accent">Live sync</span><span class="pill">Shared queue</span><span class="pill">Room history</span></div></div></section><section class="glass panel stack"><div><span class="eyebrow">Start watching</span><h3>Create or join</h3><p>Your display name is only shown inside the room.</p></div>${listRow('Display name', 'BlastPowa', 'Ready')}${listRow('Room code or invite', '6-character code', 'Paste')}<button class="primary-button">Enter watch room</button><button class="ghost-button">Create persistent party</button></section></div>
    <section><div class="section-title"><h2>Recent rooms</h2><small>Jump back in</small></div><div class="rail">${mediaCard('Friday Crew', '4 people · last night')}${mediaCard('Anime Club', '7 people · Tue')}${mediaCard('Movie Night', 'Scheduled Sat 20:30')}${mediaCard('Study Break', '2 people · Mon')}</div></section>`,

  room: () => `
    ${heading('Watch room · NW4K2Q', 'Theatre first. Everything else one move away.', 'The active room makes the synchronized player the visual anchor and moves collaboration into a compact utility dock.', 'Copy invite', 'Room settings')}
    <div class="grid-2"><section class="glass player-shell"><div class="player-video"></div><div class="player-meta"><span><strong>Current video</strong><small style="display:block;color:var(--muted);margin-top:3px">Host: BlastPowa · synced within 94 ms</small></span><div class="meta-row"><span class="pill">😊</span><span class="pill">🔥</span><span class="pill">❤️</span><span class="pill">😂</span></div></div></section><aside class="stack"><div class="dock-tabs"><span class="active">Queue</span><span>Chat</span><span>People</span><span>Moments</span><span>Discover</span></div><section class="glass panel"><div class="section-title"><h3>Up next</h3><small>7 queued</small></div><div class="list">${listRow('Studio Sessions', '8 votes · added by Kiwi', 'Next')}${listRow('Late Night Mix', '5 votes · 48 min', '▲ 5')}${listRow('Short Film', '2 votes · 16 min', '▲ 2')}</div></section><section class="glass panel"><h3>Room health</h3><p>5 watching · host connected · queue persisted · media state healthy.</p></section></aside></div>
    <section class="glass panel"><div class="section-title"><h3>Room activity</h3><small>Chat, reactions and moments share one timeline</small></div><div class="grid-3">${mediaCard('🔥 12 reactions', 'Peak at 18:42')}${mediaCard('“That timing 😭”', 'Kiwi · 1 min ago')}${mediaCard('Moment saved', 'Clip marker at 22:06')}</div></section>`,

  rooms: () => `
    ${heading('Parties', 'Your recurring rooms, scheduled nights and invites.', 'Persistent rooms become a small event dashboard: what is next, who invited you, and what you can resume.', 'Create party', 'Join by code')}
    <section class="glass spotlight"><div class="spotlight-copy"><span class="eyebrow">Next up · Saturday 20:30</span><h2>Movie Night</h2><p>6 going · Premiere source ready · invite link active</p><div class="chip-row"><span class="pill accent">Scheduled</span><span class="pill">6 RSVP</span><span class="pill">Host</span></div>${buttons('Open party', 'Share invite')}</div></section>
    <div class="grid-2"><section class="glass panel"><div class="section-title"><h3>Your parties</h3><small>4 / 10 rooms</small></div><div class="list">${listRow('Friday Crew', 'Permanent code Q7R2NE · 4 members', 'Open')}${listRow('Anime Club', 'Tue 19:00 · 7 members', 'Schedule')}${listRow('Study Break', 'No schedule · 2 members', 'Open')}</div></section><section class="glass panel"><div class="section-title"><h3>Invitations</h3><small>2 pending</small></div><div class="list">${listRow('Sci-Fi Sunday', 'Invited by Aaron · Sun 20:00', 'RSVP')}${listRow('Creator Premiere', 'Invited by Chid · Tonight', 'Join')}</div></section></div>`,

  friends: () => `
    ${heading('Friends', 'See who is around before you open a room.', 'Friend presence, co-watcher suggestions and discovery are merged into an activity-first social hub.', 'Invite friends', 'Find people')}
    <section class="glass spotlight"><div class="spotlight-copy"><span class="eyebrow">3 friends watching now</span><h2>Join the people, not just the video.</h2><p>Kiwi and Aaron are in Friday Crew. Chid is browsing music. Open a room or message first.</p>${buttons('Join Friday Crew', 'Message Kiwi')}</div></section>
    <section><div class="section-title"><h2>Online now</h2><small>Presence from NightWatch</small></div><div class="rail">${mediaCard('Kiwi', 'Watching · Friday Crew')}${mediaCard('Aaron', 'In room · 4 people')}${mediaCard('Chid', 'Browsing Music')}${mediaCard('Robert', 'Online')}</div></section>
    <div class="grid-2"><section class="glass panel"><h3>Your friends</h3><div class="list">${listRow('Kiwi', '12 rooms together · online', 'Message')}${listRow('Aaron', '8 rooms together · watching', 'Join')}${listRow('Chid', '5 rooms together · online', 'Message')}</div></section><section class="glass panel"><h3>Suggested co-watchers</h3><p>People you repeatedly share rooms with but have not added yet.</p><div class="list">${listRow('Nova', '3 shared rooms', 'Add')}${listRow('Ash', '2 shared rooms', 'Add')}</div></section></div>`,

  messages: () => `
    ${heading('Messages', 'Conversation stays beside the watch party.', 'A familiar three-pane messenger: searchable conversations, focused thread, lightweight profile/room context.', 'New message', 'New group')}
    <section class="glass messages-layout"><aside class="messages-pane"><span class="eyebrow">Conversations</span><div class="list">${listRow('Kiwi', 'You: send the room link', '2m')}${listRow('Movie Night', 'Aaron: Saturday?', '1h')}${listRow('Chid', 'Queue fix is live', '3h')}</div></aside><div class="messages-pane" style="display:flex;flex-direction:column"><div><span class="eyebrow">Kiwi · online</span><h3 style="margin:4px 0 18px">Direct message</h3></div><div class="message-bubble">Are we doing movie night later?</div><div class="message-bubble self">Yeah — I made the room already.</div><div class="message-bubble">Perfect, send the invite 👀</div><div class="message-bubble self">NW4K2Q · starts at 20:30</div><div class="composer"><input placeholder="Message Kiwi" /><button class="primary-button">Send</button></div></div><aside class="messages-pane"><span class="eyebrow">Context</span><div class="profile-avatar" style="width:68px;height:68px;border-radius:20px;margin:18px auto">K</div><h3 style="text-align:center">Kiwi</h3><p style="text-align:center;color:var(--muted);font-size:11px">12 shared rooms</p><button class="ghost-button" style="width:100%;margin-top:14px">Invite to room</button></aside></section>`,

  creator: () => `
    ${heading('Creator Club', 'Run a club like a tiny studio.', 'Club identity, active bounties, submissions and moderation become one coherent workspace with discovery secondary.', 'Create bounty', 'Discover clubs')}
    <section class="glass profile-hero"><div class="profile-avatar">CC</div><div><span class="eyebrow">NightWatch Creator Club</span><h1 style="margin:5px 0 6px;font-size:36px">Midnight Makers</h1><p style="margin:0;color:var(--muted)">24 members · 4 moderators · 3 active bounties</p></div>${buttons('Invite members', 'Club settings')}</section>
    <div class="grid-2"><section class="glass panel"><div class="section-title"><h3>Active bounties</h3><small>Board</small></div><div class="list">${listRow('Best intro animation', '8 submissions · closes Friday', 'Review')}${listRow('Trailer remix', '4 submissions · 1 day left', 'Open')}${listRow('Community poster', '12 submissions', 'Vote')}</div></section><aside class="stack"><section class="glass panel"><h3>Moderation</h3><p>2 reports need review. Audit history is healthy.</p><button class="ghost-button" style="margin-top:14px">Open moderation</button></section><section class="glass panel"><h3>Club pulse</h3><p>+6 members this week · 84% bounty completion.</p></section></aside></div>`,

  library: () => `
    ${heading('Library', 'Your authorized media, ready for the room.', 'Local files and Google Drive stay clearly separated but share one browse model, resume state and Watch in Room action.', 'Add local media', 'Connect Drive')}
    <section class="glass spotlight"><div class="spotlight-copy"><span class="eyebrow">Continue from your library</span><h2>Blade Runner cut</h2><p>Local media · 01:14:22 remaining · fingerprint matched</p>${buttons('Resume in room', 'Details')}</div></section>
    <div class="chip-row"><span class="pill accent">All media</span><span class="pill">Local files</span><span class="pill">Google Drive</span><span class="pill">Recently played</span></div>
    <section><div class="section-title"><h2>Your media</h2><small>18 items</small></div><div class="grid-4">${mediaCard('Movie Night Cut', 'Local · MP4', '42%')}${mediaCard('Episode 06', 'Drive · WebM')}${mediaCard('Concert Film', 'Local · MP4')}${mediaCard('Short Film', 'Drive · MP4')}</div></section>`,

  faq: () => `
    ${heading('FAQ', 'Answers without leaving the app.', 'Search is the first interaction. Categories and accordions stay readable, compact and keyboard-friendly.', 'Open setup guide')}
    <section class="glass faq-search"><span class="eyebrow">NightWatch help</span><h2>What can we help with?</h2><p style="color:var(--muted);margin:0">Rooms, playback, sync, Library, Drive, Discord and privacy.</p><label><input placeholder="Search questions" /></label></section>
    <div class="grid-3"><section class="glass panel"><h3>Rooms & playback</h3><p>Joining, host controls, queue and synchronization.</p></section><section class="glass panel"><h3>Library & Drive</h3><p>Authorized files, permissions and supported formats.</p></section><section class="glass panel"><h3>Account & privacy</h3><p>Discord connection, social features and data handling.</p></section></div>
    <section class="glass panel"><div class="list">${listRow('How does synchronization work?', 'Playback & rooms', '⌄')}${listRow('Can I play local files with friends?', 'Library & Drive', '⌄')}${listRow('What does NightWatch store?', 'Privacy', '⌄')}</div></section>`,

  settings: () => `
    ${heading('Settings', 'Tune NightWatch without digging through menus.', 'A persistent category rail keeps high-frequency options discoverable while the large detail pane can show live previews.', 'Save changes', 'Reset defaults')}
    <div class="settings-layout"><aside class="glass settings-rail"><span class="active">Appearance</span><span>Playback</span><span>Audio & video</span><span>Chat</span><span>Account</span><span>Integrations</span><span>Accessibility</span><span>Advanced</span></aside><section class="glass panel"><span class="eyebrow">Appearance</span><h2 style="margin:4px 0 6px">Make NightWatch yours</h2><p>Theme, accent, background media, density and motion.</p><div class="setting-row"><span><strong>Theme</strong><small style="display:block;color:var(--muted);margin-top:4px">Obsidian + teal</small></span><div class="swatches"><span class="swatch" style="--c:#52e0cf"></span><span class="swatch" style="--c:#7459ff"></span><span class="swatch" style="--c:#d84455"></span></div></div><div class="setting-row"><span><strong>Cinematic background</strong><small style="display:block;color:var(--muted);margin-top:4px">Use an image or local video behind glass surfaces</small></span><span class="toggle"></span></div><div class="setting-row"><span><strong>Hover previews</strong><small style="display:block;color:var(--muted);margin-top:4px">Disable automatically with reduced motion</small></span><span class="toggle"></span></div><div class="glass spotlight" style="min-height:210px;margin-top:18px;padding:20px"><div class="spotlight-copy" style="min-height:150px"><span class="eyebrow">Live preview</span><h2 style="font-size:34px">Cinema shell</h2><p>Your current appearance settings render here before leaving the page.</p></div></div></section></div>`,

  profile: () => `
    ${heading('Profile', 'Your NightWatch identity and history.', 'The old stat card becomes a profile surface: identity first, stats second, then achievements, borders and recent activity.', 'Edit profile', 'Share card')}
    <section class="glass profile-hero"><div class="profile-avatar">BP</div><div><span class="eyebrow">NightWatch profile</span><h1 style="margin:5px 0 6px;font-size:38px">BlastPowa</h1><p style="margin:0;color:var(--muted)">Night Owl · 14-night streak · border: First Room</p></div>${buttons('Customize', 'View achievements')}</section>
    <section class="stat-strip">${[['42','Rooms'],['126h','Watch time'],['1.8k','Reactions'],['640','Messages'],['93','Videos']].map(([v,l])=>`<div class="glass stat"><strong>${v}</strong><small>${l}</small></div>`).join('')}</section>
    <div class="grid-2"><section><div class="section-title"><h2>Achievements</h2><small>14 / 22 unlocked</small></div><div class="grid-3">${mediaCard('First Night','Unlocked')}${mediaCard('Queue Master','Unlocked')}${mediaCard('Night Owl','7-day streak')}</div></section><section class="glass panel"><h3>Recent activity</h3><div class="list">${listRow('Friday Crew', '2h 18m watched', 'Yesterday')}${listRow('Anime Club', '46 reactions', 'Tue')}${listRow('Movie Night', 'Achievement unlocked', 'Sat')}</div></section></div>`,

  about: () => `
    ${heading('About', 'NightWatch, build status and release notes.', 'Brand information and update controls become a release dashboard instead of a plain diagnostics card.', 'Check for updates', 'Open changelog')}
    <section class="glass spotlight"><div class="spotlight-copy"><span class="eyebrow">NightWatch Desktop</span><h2>Version 0.1.27</h2><p>Electron desktop · Windows x64 · update channel stable</p><div class="chip-row"><span class="pill accent">Up to date</span><span class="pill">Sync engine healthy</span><span class="pill">Installer verified</span></div>${buttons('Check now', 'Release notes')}</div></section>
    <div class="grid-3"><section class="glass panel"><h3>Runtime</h3><p>Electron 33 · Vite renderer · Supabase realtime.</p></section><section class="glass panel"><h3>Updates</h3><p>GitHub Releases with in-app download and restart.</p></section><section class="glass panel"><h3>Privacy</h3><p>Room synchronization sends state, never protected media bytes.</p></section></div>
    <section class="glass panel"><div class="section-title"><h3>What’s new</h3><small>0.1.27</small></div><div class="list">${listRow('Entertainment revamp started', 'Shared cinematic shell and concept set', 'New')}${listRow('Reliability pass', 'Reconnect and host-migration hardening', 'Improved')}${listRow('Installer refresh', 'Cleaner release and update experience', 'Improved')}</div></section>`,
};

function buildNav(active) {
  let currentGroup = '';
  nav.innerHTML = pages.map(([group, id, icon, label]) => {
    const groupMarkup = group !== currentGroup ? `<div class="nav-group">${group}</div>` : '';
    currentGroup = group;
    return `${groupMarkup}<button class="concept-nav-button ${id === active ? 'active' : ''}" data-view="${id}"><span>${icon}</span><span>${label}</span></button>`;
  }).join('');
  nav.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => select(button.dataset.view)));
}

function select(id) {
  if (!concepts[id]) id = 'discover';
  const label = pages.find((page) => page[1] === id)?.[3] || 'Browse';
  const url = new URL(window.location.href);
  url.searchParams.set('view', id);
  window.history.replaceState({}, '', url);
  pageName.textContent = label;
  stage.innerHTML = concepts[id]();
  stage.dataset.view = id;
  buildNav(id);
  window.scrollTo({ top: 0, behavior: 'instant' });
}

const initialView = new URL(window.location.href).searchParams.get('view') || 'discover';
select(initialView);
