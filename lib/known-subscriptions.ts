/**
 * Curated database of known subscription services.
 * Used to detect subscriptions from a single transaction —
 * no recurring pattern needed if the merchant is in this list.
 */

export interface KnownSubscription {
  patterns: string[];
  name: string;
  defaultFrequency: "weekly" | "monthly" | "yearly";
  category: string;
}

export const KNOWN_SUBSCRIPTIONS: KnownSubscription[] = [
  // ── Streaming Video ───────────────────────────────────────────────────────
  { patterns: ["netflix"], name: "Netflix", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["hulu"], name: "Hulu", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["disney+", "disney plus", "disneyplus"], name: "Disney+", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["hbo max", "hbomax", "max.com"], name: "Max (HBO)", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["paramount+", "paramount plus", "paramountplus"], name: "Paramount+", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["peacock", "peacocktv"], name: "Peacock", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["apple tv", "appletv"], name: "Apple TV+", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["amazon prime video", "primevideo"], name: "Prime Video", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["crave", "cravetv"], name: "Crave", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["crunchyroll"], name: "Crunchyroll", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["funimation"], name: "Funimation", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["mubi"], name: "MUBI", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["criterion channel"], name: "Criterion Channel", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["curiositystream", "curiosity stream"], name: "CuriosityStream", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["discovery+", "discovery plus"], name: "Discovery+", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["tubi"], name: "Tubi", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["youtube premium", "youtube music", "youtube tv", "google youtube"], name: "YouTube Premium", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["twitch", "twitch.tv"], name: "Twitch", defaultFrequency: "monthly", category: "ENTERTAINMENT" },

  // ── Music ─────────────────────────────────────────────────────────────────
  { patterns: ["spotify"], name: "Spotify", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["apple music"], name: "Apple Music", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["tidal"], name: "Tidal", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["deezer"], name: "Deezer", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["soundcloud"], name: "SoundCloud", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["pandora"], name: "Pandora", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["amazon music"], name: "Amazon Music", defaultFrequency: "monthly", category: "ENTERTAINMENT" },

  // ── AI / Developer Tools ──────────────────────────────────────────────────
  { patterns: ["openai", "chatgpt", "chat gpt"], name: "ChatGPT Plus", defaultFrequency: "monthly", category: "SOFTWARE" },
  { patterns: ["anthropic", "claude.ai", "claude ai"], name: "Claude Pro", defaultFrequency: "monthly", category: "SOFTWARE" },
  { patterns: ["cursor", "cursor.sh", "cursor.com"], name: "Cursor Pro", defaultFrequency: "monthly", category: "SOFTWARE" },
  { patterns: ["github copilot", "copilot"], name: "GitHub Copilot", defaultFrequency: "monthly", category: "SOFTWARE" },
  { patterns: ["midjourney", "mid journey"], name: "Midjourney", defaultFrequency: "monthly", category: "SOFTWARE" },
  { patterns: ["replit"], name: "Replit", defaultFrequency: "monthly", category: "SOFTWARE" },
  { patterns: ["vercel"], name: "Vercel", defaultFrequency: "monthly", category: "SOFTWARE" },
  { patterns: ["netlify"], name: "Netlify", defaultFrequency: "monthly", category: "SOFTWARE" },
  { patterns: ["heroku"], name: "Heroku", defaultFrequency: "monthly", category: "SOFTWARE" },
  { patterns: ["perplexity"], name: "Perplexity Pro", defaultFrequency: "monthly", category: "SOFTWARE" },
  { patterns: ["runway", "runwayml"], name: "Runway", defaultFrequency: "monthly", category: "SOFTWARE" },

  // ── Software / Productivity ───────────────────────────────────────────────
  { patterns: ["adobe", "creative cloud"], name: "Adobe Creative Cloud", defaultFrequency: "monthly", category: "SOFTWARE" },
  { patterns: ["microsoft 365", "microsoft office", "office 365", "ms 365"], name: "Microsoft 365", defaultFrequency: "monthly", category: "SOFTWARE" },
  { patterns: ["google one", "google storage"], name: "Google One", defaultFrequency: "monthly", category: "SOFTWARE" },
  { patterns: ["google workspace"], name: "Google Workspace", defaultFrequency: "monthly", category: "SOFTWARE" },
  { patterns: ["dropbox"], name: "Dropbox", defaultFrequency: "monthly", category: "SOFTWARE" },
  { patterns: ["icloud", "apple.com/bill", "apple.com bill"], name: "iCloud+", defaultFrequency: "monthly", category: "SOFTWARE" },
  { patterns: ["notion"], name: "Notion", defaultFrequency: "monthly", category: "SOFTWARE" },
  { patterns: ["1password", "one password", "onepassword"], name: "1Password", defaultFrequency: "monthly", category: "SOFTWARE" },
  { patterns: ["lastpass"], name: "LastPass", defaultFrequency: "monthly", category: "SOFTWARE" },
  { patterns: ["bitwarden"], name: "Bitwarden", defaultFrequency: "yearly", category: "SOFTWARE" },
  { patterns: ["dashlane"], name: "Dashlane", defaultFrequency: "monthly", category: "SOFTWARE" },
  { patterns: ["github"], name: "GitHub", defaultFrequency: "monthly", category: "SOFTWARE" },
  { patterns: ["gitlab"], name: "GitLab", defaultFrequency: "monthly", category: "SOFTWARE" },
  { patterns: ["jetbrains"], name: "JetBrains", defaultFrequency: "monthly", category: "SOFTWARE" },
  { patterns: ["figma"], name: "Figma", defaultFrequency: "monthly", category: "SOFTWARE" },
  { patterns: ["canva"], name: "Canva", defaultFrequency: "monthly", category: "SOFTWARE" },
  { patterns: ["slack"], name: "Slack", defaultFrequency: "monthly", category: "SOFTWARE" },
  { patterns: ["zoom", "zoom.us"], name: "Zoom", defaultFrequency: "monthly", category: "SOFTWARE" },
  { patterns: ["grammarly"], name: "Grammarly", defaultFrequency: "monthly", category: "SOFTWARE" },
  { patterns: ["evernote"], name: "Evernote", defaultFrequency: "monthly", category: "SOFTWARE" },
  { patterns: ["todoist"], name: "Todoist", defaultFrequency: "monthly", category: "SOFTWARE" },
  { patterns: ["linear"], name: "Linear", defaultFrequency: "monthly", category: "SOFTWARE" },
  { patterns: ["superhuman"], name: "Superhuman", defaultFrequency: "monthly", category: "SOFTWARE" },
  { patterns: ["proton", "protonmail", "proton mail"], name: "Proton", defaultFrequency: "monthly", category: "SOFTWARE" },
  { patterns: ["nordvpn", "nord vpn"], name: "NordVPN", defaultFrequency: "monthly", category: "SOFTWARE" },
  { patterns: ["expressvpn", "express vpn"], name: "ExpressVPN", defaultFrequency: "monthly", category: "SOFTWARE" },
  { patterns: ["surfshark"], name: "Surfshark", defaultFrequency: "monthly", category: "SOFTWARE" },
  { patterns: ["mullvad"], name: "Mullvad VPN", defaultFrequency: "monthly", category: "SOFTWARE" },
  { patterns: ["tailscale"], name: "Tailscale", defaultFrequency: "monthly", category: "SOFTWARE" },
  { patterns: ["cloudflare"], name: "Cloudflare", defaultFrequency: "monthly", category: "SOFTWARE" },

  // ── Cloud Storage / Hosting ───────────────────────────────────────────────
  { patterns: ["aws", "amazon web services"], name: "AWS", defaultFrequency: "monthly", category: "SOFTWARE" },
  { patterns: ["digitalocean", "digital ocean"], name: "DigitalOcean", defaultFrequency: "monthly", category: "SOFTWARE" },
  { patterns: ["linode"], name: "Linode", defaultFrequency: "monthly", category: "SOFTWARE" },

  // ── Gaming ────────────────────────────────────────────────────────────────
  { patterns: ["xbox", "game pass", "gamepass"], name: "Xbox Game Pass", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["playstation", "ps plus", "psplus", "ps+"], name: "PlayStation Plus", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["nintendo online", "nintendo switch online"], name: "Nintendo Switch Online", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["ea play", "ea sports"], name: "EA Play", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["steam"], name: "Steam", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["epic games"], name: "Epic Games", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["geforce now"], name: "GeForce Now", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["discord nitro", "discord"], name: "Discord Nitro", defaultFrequency: "monthly", category: "ENTERTAINMENT" },

  // ── News / Reading / Learning ─────────────────────────────────────────────
  { patterns: ["nytimes", "new york times", "ny times"], name: "New York Times", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["wsj", "wall street journal"], name: "Wall Street Journal", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["washington post"], name: "Washington Post", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["the athletic"], name: "The Athletic", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["substack"], name: "Substack", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["medium"], name: "Medium", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["kindle unlimited"], name: "Kindle Unlimited", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["audible"], name: "Audible", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["scribd"], name: "Scribd", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["skillshare"], name: "Skillshare", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["masterclass"], name: "MasterClass", defaultFrequency: "yearly", category: "ENTERTAINMENT" },
  { patterns: ["coursera"], name: "Coursera", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["brilliant"], name: "Brilliant", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["duolingo"], name: "Duolingo", defaultFrequency: "monthly", category: "ENTERTAINMENT" },

  // ── Fitness / Wellness ────────────────────────────────────────────────────
  { patterns: ["peloton"], name: "Peloton", defaultFrequency: "monthly", category: "RECREATION" },
  { patterns: ["strava"], name: "Strava", defaultFrequency: "monthly", category: "RECREATION" },
  { patterns: ["headspace"], name: "Headspace", defaultFrequency: "monthly", category: "RECREATION" },
  { patterns: ["calm app", "calm.com"], name: "Calm", defaultFrequency: "monthly", category: "RECREATION" },
  { patterns: ["myfitnesspal", "my fitness pal"], name: "MyFitnessPal", defaultFrequency: "monthly", category: "RECREATION" },
  { patterns: ["fitbit premium", "fitbit"], name: "Fitbit Premium", defaultFrequency: "monthly", category: "RECREATION" },
  { patterns: ["apple fitness"], name: "Apple Fitness+", defaultFrequency: "monthly", category: "RECREATION" },
  { patterns: ["planet fitness"], name: "Planet Fitness", defaultFrequency: "monthly", category: "RECREATION" },
  { patterns: ["la fitness"], name: "LA Fitness", defaultFrequency: "monthly", category: "RECREATION" },
  { patterns: ["equinox"], name: "Equinox", defaultFrequency: "monthly", category: "RECREATION" },
  { patterns: ["orangetheory", "orange theory"], name: "Orangetheory", defaultFrequency: "monthly", category: "RECREATION" },
  { patterns: ["f45"], name: "F45 Training", defaultFrequency: "monthly", category: "RECREATION" },
  { patterns: ["crossfit"], name: "CrossFit", defaultFrequency: "monthly", category: "RECREATION" },
  { patterns: ["anytime fitness"], name: "Anytime Fitness", defaultFrequency: "monthly", category: "RECREATION" },
  { patterns: ["goodlife", "good life"], name: "GoodLife Fitness", defaultFrequency: "monthly", category: "RECREATION" },
  { patterns: ["ymca", "ywca"], name: "YMCA", defaultFrequency: "monthly", category: "RECREATION" },
  { patterns: ["barry's", "barrys bootcamp"], name: "Barry's", defaultFrequency: "monthly", category: "RECREATION" },
  { patterns: ["soulcycle", "soul cycle"], name: "SoulCycle", defaultFrequency: "monthly", category: "RECREATION" },
  { patterns: ["classpass", "class pass"], name: "ClassPass", defaultFrequency: "monthly", category: "RECREATION" },
  { patterns: ["noom"], name: "Noom", defaultFrequency: "monthly", category: "RECREATION" },
  { patterns: ["whoop"], name: "WHOOP", defaultFrequency: "monthly", category: "RECREATION" },

  // ── Delivery / Memberships ────────────────────────────────────────────────
  { patterns: ["amazon prime", "amzn prime", "prime membership"], name: "Amazon Prime", defaultFrequency: "monthly", category: "SHOPPING" },
  { patterns: ["instacart", "instacart+"], name: "Instacart+", defaultFrequency: "monthly", category: "FOOD_AND_DRINK" },
  { patterns: ["doordash", "dashpass"], name: "DoorDash DashPass", defaultFrequency: "monthly", category: "FOOD_AND_DRINK" },
  { patterns: ["uber one", "uber pass", "uber eats pass"], name: "Uber One", defaultFrequency: "monthly", category: "FOOD_AND_DRINK" },
  { patterns: ["grubhub+", "grubhub plus"], name: "Grubhub+", defaultFrequency: "monthly", category: "FOOD_AND_DRINK" },
  { patterns: ["walmart+", "walmart plus"], name: "Walmart+", defaultFrequency: "monthly", category: "SHOPPING" },
  { patterns: ["costco membership", "costco wholesale"], name: "Costco Membership", defaultFrequency: "yearly", category: "SHOPPING" },
  { patterns: ["sam's club"], name: "Sam's Club", defaultFrequency: "yearly", category: "SHOPPING" },

  // ── Phone / Telecom ───────────────────────────────────────────────────────
  { patterns: ["t-mobile", "tmobile"], name: "T-Mobile", defaultFrequency: "monthly", category: "TELECOM" },
  { patterns: ["at&t", "att wireless", "at t"], name: "AT&T", defaultFrequency: "monthly", category: "TELECOM" },
  { patterns: ["verizon"], name: "Verizon", defaultFrequency: "monthly", category: "TELECOM" },
  { patterns: ["mint mobile"], name: "Mint Mobile", defaultFrequency: "monthly", category: "TELECOM" },
  { patterns: ["visible"], name: "Visible", defaultFrequency: "monthly", category: "TELECOM" },
  { patterns: ["google fi"], name: "Google Fi", defaultFrequency: "monthly", category: "TELECOM" },
  { patterns: ["rogers wireless", "rogers communications"], name: "Rogers", defaultFrequency: "monthly", category: "TELECOM" },
  { patterns: ["bell mobility", "bell canada"], name: "Bell", defaultFrequency: "monthly", category: "TELECOM" },
  { patterns: ["telus"], name: "Telus", defaultFrequency: "monthly", category: "TELECOM" },
  { patterns: ["fido"], name: "Fido", defaultFrequency: "monthly", category: "TELECOM" },
  { patterns: ["koodo"], name: "Koodo", defaultFrequency: "monthly", category: "TELECOM" },
  { patterns: ["freedom mobile"], name: "Freedom Mobile", defaultFrequency: "monthly", category: "TELECOM" },

  // ── Financial Services / Card Fees ────────────────────────────────────────
  { patterns: ["american express", "amex", "amex fee"], name: "Amex Card Fee", defaultFrequency: "monthly", category: "FINANCIAL" },
  { patterns: ["chase sapphire", "chase annual"], name: "Chase Card Fee", defaultFrequency: "yearly", category: "FINANCIAL" },
  { patterns: ["citi annual", "citi card"], name: "Citi Card Fee", defaultFrequency: "yearly", category: "FINANCIAL" },
  { patterns: ["capital one annual"], name: "Capital One Fee", defaultFrequency: "yearly", category: "FINANCIAL" },
  { patterns: ["ynab", "you need a budget"], name: "YNAB", defaultFrequency: "yearly", category: "FINANCIAL" },
  { patterns: ["copilot money"], name: "Copilot Money", defaultFrequency: "monthly", category: "FINANCIAL" },
  { patterns: ["rocket money", "truebill"], name: "Rocket Money", defaultFrequency: "monthly", category: "FINANCIAL" },
  { patterns: ["wealthsimple"], name: "Wealthsimple", defaultFrequency: "monthly", category: "FINANCIAL" },

  // ── Dating ────────────────────────────────────────────────────────────────
  { patterns: ["tinder"], name: "Tinder", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["bumble"], name: "Bumble", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["hinge"], name: "Hinge", defaultFrequency: "monthly", category: "ENTERTAINMENT" },

  // ── Internet / Home ───────────────────────────────────────────────────────
  { patterns: ["starlink"], name: "Starlink", defaultFrequency: "monthly", category: "TELECOM" },
  { patterns: ["comcast", "xfinity"], name: "Xfinity", defaultFrequency: "monthly", category: "TELECOM" },
  { patterns: ["spectrum"], name: "Spectrum", defaultFrequency: "monthly", category: "TELECOM" },
  { patterns: ["cox communications"], name: "Cox", defaultFrequency: "monthly", category: "TELECOM" },

  // ── Miscellaneous ─────────────────────────────────────────────────────────
  { patterns: ["patreon"], name: "Patreon", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["onlyfans"], name: "OnlyFans", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["buy me a coffee", "buymeacoffee"], name: "Buy Me a Coffee", defaultFrequency: "monthly", category: "ENTERTAINMENT" },
  { patterns: ["google play", "google store"], name: "Google Play", defaultFrequency: "monthly", category: "SOFTWARE" },
  { patterns: ["apple app store", "apple store"], name: "Apple App Store", defaultFrequency: "monthly", category: "SOFTWARE" },
];

/**
 * Build a lookup index for fast matching.
 * Returns a function that checks if a normalized merchant name matches any known subscription.
 */
function buildMatcher(): (normalizedMerchant: string) => KnownSubscription | null {
  const entries = KNOWN_SUBSCRIPTIONS.flatMap((sub) =>
    sub.patterns.map((p) => ({ pattern: p.toLowerCase(), sub }))
  );
  // Sort longest patterns first to prefer more specific matches
  entries.sort((a, b) => b.pattern.length - a.pattern.length);

  return (normalizedMerchant: string): KnownSubscription | null => {
    const lower = normalizedMerchant.toLowerCase();
    for (const { pattern, sub } of entries) {
      if (lower.includes(pattern)) return sub;
    }
    return null;
  };
}

let _matcher: ReturnType<typeof buildMatcher> | null = null;

export function matchKnownSubscription(normalizedMerchant: string): KnownSubscription | null {
  if (!_matcher) _matcher = buildMatcher();
  return _matcher(normalizedMerchant);
}
