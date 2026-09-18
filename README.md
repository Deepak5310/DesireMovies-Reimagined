# DesireMovies Telegram Bot & Auto Tracker 🎬⚡

Automated DesireMovies post scraper, multi-hop direct bypass resolver, and Telegram channel broadcaster.

## 🚀 Features

- **Automated Tracking:** Periodically polls DesireMovies (RSS feed & homepage) for new releases.
- **Dynamic Domain Self-Healing:** Automatically scrapes `https://desiremovies.my/` when domains change or fail.
- **Direct Multi-Hop Bypass:** Resolves intermediate gateway links (HubCloud, KMHD, GDFlix, Gyanigurus) directly to high-speed media streams without manual captcha/waiting.
- **Clean Channel Posts:** Extracts structured metadata (IMDb rating, Audio language, Genre, clean Storyline) and compact inline keyboard buttons.
- **Manual Publishing & Bypassing:** Send any post link directly to the bot in DM or use `/post <url>` to broadcast to channel.
- **24/7 Free Hosting Ready:** Built-in HTTP health-check server on `process.env.PORT || 3000` for Render/Koyeb deployments.

## 🛠️ Environment Variables

Copy `.env.example` to `.env` and fill in:

```env
BOT_TOKEN=your_telegram_bot_token_from_botfather
CHANNEL_ID=@your_channel_username_or_id
SITE_URL=https://1desiremovies.cymru
POLL_INTERVAL=120
AUTO_RESOLVE=true
```

## 📦 Installation & Running

```bash
# Install dependencies
npm install

# Start the bot
npm start

# Development with auto-reload
npm run dev
```

## 🤖 Bot Commands

- `/start` - Welcome message and usage instructions.
- `/search <query>` - Search movies & TV series with 1-click publish/download buttons.
- `/status` - View current tracked site, channel, and cached posts count.
- `/post <url>` - Manually scrape and broadcast a post to the channel.
- `/bypass <url>` - Resolve a single download/stream link.
- `/check` - Trigger an immediate scan for new releases.
