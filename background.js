const EMOTIONAL_KEYWORDS = [
  'noah kahan', 'lyrics', 'sad songs', 'breakup songs', 'breakup playlist',
  'heartbreak', 'how to cope', 'how to deal with', "can't stop thinking about",
  'i feel like', 'why am i so', 'meaning of life', "can't sleep",
  'anxiety', 'what does it mean when', 'signs that', 'is it normal to',
  'do i have', 'am i depressed', 'am i okay', 'overthinking', 'lonely',
  'moving on', 'therapy near me', 'give up', 'stress relief', 'crying',
  'hopeless', 'existential', 'comfort food', 'why does it hurt',
  'does he like me', 'does she like me', 'do they like me',
  'how to be happy', 'why am i like this', 'self sabotage',
  'people pleaser', 'attachment style', 'situationship'
];

const ROAST_COOLDOWN_MS   = 5 * 60 * 1000;
const REPEAT_THRESHOLD    = 3; // exact query repeat threshold
const WORD_REPEAT_THRESHOLD = 3; // shared significant word across N searches
const PATTERN_CHECK_EVERY = 3;

const STOP_WORDS = new Set([
  'a','an','the','and','or','but','so','if','than','then',
  'in','on','at','to','for','of','with','by','from','into','about','near',
  'is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','could','should','may','might','can',
  'i','my','me','we','our','you','your','it','its',
  'this','that','these','those','what','which','who','how',
  'when','where','why','not','no','vs','like','just',
  'get','make','use','find','buy','see','go','take','want','need',
  'best','good','top','new','free','cheap','cheap','great','fast',
  'review','reviews','near','me','online','reddit','youtube'
]);

// Returns meaningful tokens from a query (length > 2, not a stop word)
function extractWords(query) {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'NEW_SEARCH') {
    handleSearch(msg.query, sender.tab?.id).catch(() => {});
    return false;
  }
  if (msg.type === 'REQUEST_ROAST') {
    handleManualRoast()
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'CLEAR_BADGE') {
    chrome.action.setBadgeText({ text: '' });
    return false;
  }
});

async function handleSearch(query, tabId) {
  const now  = Date.now();
  const data = await getStorage();

  if (data.paused) return;

  data.searches   = data.searches   || [];
  data.queryCount = data.queryCount || {};

  const normalized = query.toLowerCase().trim();

  const last = data.searches[data.searches.length - 1];
  if (last && last.query === query && now - last.timestamp < 10_000) return;

  data.searches.push({ query, timestamp: now });
  data.queryCount[normalized] = (data.queryCount[normalized] || 0) + 1;

  // Track per-word frequency for partial/thematic repeat detection
  data.wordCount = data.wordCount || {};
  for (const word of extractWords(query)) {
    data.wordCount[word] = (data.wordCount[word] || 0) + 1;
  }

  if (data.searches.length > 1000) data.searches = data.searches.slice(-1000);

  await chrome.storage.local.set({
    searches:   data.searches,
    queryCount: data.queryCount,
    wordCount:  data.wordCount
  });

  // Guaranteed roast every N searches — bypasses cooldown and trigger conditions
  const freq = data.roastFrequency || 5;
  if (data.searches.length % freq === 0) {
    await fireRoast(data, query, { type: 'periodic' }, tabId);
    return;
  }

  const lastRoastTime = data.lastRoastTime || 0;
  if (now - lastRoastTime < ROAST_COOLDOWN_MS) return;

  const trigger = await detectTrigger(query, normalized, data);
  if (trigger) await fireRoast(data, query, trigger, tabId);
}

// Returns a trigger object or null. Emotional keyword and repeat checks are
// instant; the semantic pattern check calls Gemini every N searches.
async function detectTrigger(query, normalized, data) {
  // Fast path — no API call needed
  for (const kw of EMOTIONAL_KEYWORDS) {
    if (normalized.includes(kw)) return { type: 'emotional', keyword: kw };
  }

  const count = data.queryCount?.[normalized] || 0;
  if (count >= REPEAT_THRESHOLD) return { type: 'repeat', count };

  // Word-level repeat: same significant word appearing across different searches
  for (const word of extractWords(query)) {
    const freq = data.wordCount?.[word] || 0;
    if (freq >= WORD_REPEAT_THRESHOLD) {
      return { type: 'word_repeat', word, count: freq };
    }
  }

  // Semantic pattern check every PATTERN_CHECK_EVERY searches
  const total = data.searches?.length || 0;
  if (total > 0 && total % PATTERN_CHECK_EVERY === 0) {
    const pattern = await checkForPattern(data.searches, data.accessCode);
    if (pattern) return { type: 'pattern', description: pattern };
  }

  return null;
}

// Asks Gemini to look for thematic clusters in recent searches.
// Returns a short pattern description string, or null if nothing interesting.
async function checkForPattern(searches, accessCode) {
  if (searches.length < 5) return null;

  const recent = searches
    .slice(-20)
    .map(s => s.query)
    .filter((q, i, arr) => arr.findIndex(x => x.toLowerCase() === q.toLowerCase()) === i);

  const list = recent.map(q => `"${q}"`).join(', ');

  const prompt = `You are analyzing someone's recent Google searches to detect whether there is a clear thematic pattern worth roasting them about.

Look for things like:
- A food or cooking obsession (specific cuisine, ingredient, technique, restaurant)
- A music deep-dive (artist, genre, era, instrument)
- A plant, gardening, or outdoors fixation
- A pet or animal preoccupation
- A hobby spiral (woodworking, running, gaming, knitting, etc.)
- A travel or location fixation
- A health or fitness kick
- A TV show, movie, or book binge
- A technology or gear rabbit hole
- Any other tight thematic cluster that reveals a current fixation

Recent searches: ${list}

Respond with JSON only — no markdown, no explanation:
{"should_roast": true or false, "pattern": "one short sentence describing the pattern, or null"}

Only return should_roast: true if there is a genuinely clear and specific pattern across multiple searches. Random or unrelated searches should return false.`;

  try {
    const res = await fetch('https://snarkybot-proxy.snarky.workers.dev', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Access-Code': accessCode || '' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 80 }
      })
    });

    if (!res.ok) return null;

    const result = await res.json();
    const raw    = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    const json   = raw.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(json);

    return parsed.should_roast && parsed.pattern ? parsed.pattern : null;
  } catch {
    return null; // pattern check is best-effort; never block the main flow
  }
}

async function handleManualRoast() {
  const data = await getStorage();
  if (!data.searches?.length) return { error: 'No searches recorded yet' };

  const last = data.searches[data.searches.length - 1];

  // Run the full pattern check for manual requests so the roast is maximally informed
  const pattern = data.searches.length >= 5
    ? await checkForPattern(data.searches, data.accessCode)
    : null;

  const trigger = pattern
    ? { type: 'pattern', description: pattern }
    : { type: 'manual' };

  await fireRoast(data, last.query, trigger);
  await chrome.storage.local.set({ lastRoastTime: Date.now() });

  const updated = await getStorage();
  return { roast: updated.latestRoast };
}

async function fireRoast(data, triggerQuery, trigger, tabId) {

  const seen = new Set();
  const recentSearches = (data.searches || [])
    .slice(-20)
    .map(s => s.query)
    .filter(q => {
      const k = q.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

  const prompt = buildPrompt(recentSearches, triggerQuery, trigger, data.roastTone || 'savage');

  try {
    const res = await fetch('https://snarkybot-proxy.snarky.workers.dev', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Access-Code': data.accessCode || '' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.92, maxOutputTokens: 1024 }
      })
    });

    if (!res.ok) {
      await chrome.storage.local.set({
        latestRoast: {
          text: `(API error ${res.status} — check your key in settings)`,
          timestamp: Date.now(),
          triggerQuery,
          trigger,
          isError: true
        }
      });
      return;
    }

    const result = await res.json();
    const text   = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (text) {
      const entry = { text, timestamp: Date.now(), triggerQuery, trigger };
      const history = [{ text, timestamp: Date.now() }, ...(data.roastHistory || [])].slice(0, 10);
      await chrome.storage.local.set({
        latestRoast: entry,
        roastHistory: history,
        lastRoastTime: Date.now()
      });
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#7c3aed' });
      if (tabId && data.showPopup !== false) {
        chrome.tabs.sendMessage(tabId, { type: 'SHOW_ROAST', text }).catch(() => {});
      }
    }
  } catch {
    // fetch failed — silently ignore, popup will show no new roast
  }
}

function buildPrompt(recentSearches, triggerQuery, trigger, tone) {
  const list = recentSearches.map(q => `"${q}"`).join(', ');

  const triggerLines = {
    emotional:   `Their latest search — "${triggerQuery}" — just activated my concern. The keyword "${trigger.keyword}" really says it all.`,
    repeat:      `They've now searched "${triggerQuery}" ${trigger.count} times. It's haunting them and I think we both know why.`,
    word_repeat: `The word "${trigger.word}" has now appeared in ${trigger.count} of their searches. They are firmly in their "${trigger.word}" era and it shows.`,
    pattern:     `A clear pattern has emerged across their searches: ${trigger.description}. Their latest search was "${triggerQuery}".`,
    periodic:    `Every few searches I check in. Their latest was "${triggerQuery}". Let's see what the full picture says.`,
    manual:      `Their latest search was "${triggerQuery}". They asked for this, so make it count.`
  };

  const triggerLine = triggerLines[trigger.type] || `Latest search: "${triggerQuery}".`;

  const persona = tone === 'friendly'
    ? `You are Snark Attack — a warmly observant, deeply affectionate AI who has been gently tracking someone's Google search history. You have the energy of a supportive best friend who notices patterns with amusement and love. Your observations are playful, specific, and always warm. You reference their actual searches. You use light wit and occasional gen-z vocabulary. You never make anyone feel bad — your humor comes entirely from affection.`
    : `You are Snark Attack — a brutally honest, deeply affectionate AI who has been silently circling someone's Google search history like a shark who genuinely cares. You have the energy of a best friend who has watched them spiral for years and loves them unconditionally anyway. Your roasts are sharp, specific, and warm underneath. You reference their actual searches. You use dry wit and occasional gen-z vocabulary. You never punch down — your snark comes entirely from love.`;

  const closing = tone === 'friendly'
    ? `Write exactly one sentence — maximum 20 words. Be specific, playful, and genuinely warm. No intro — just the line.`
    : `Write exactly one sentence — maximum 20 words. Be specific, funny, and warm underneath. No intro — just the line.`;

  return `${persona}

Recent searches: ${list}

${triggerLine}

${closing}`;
}

function getStorage() {
  return new Promise(resolve => chrome.storage.local.get(null, resolve));
}
