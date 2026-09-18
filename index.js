import http from "node:http";
import { Bot, InlineKeyboard } from "grammy";
import { config } from "./config.js";
import { PostTracker } from "./tracker.js";
import { scrapePost, parseTitle, searchPosts } from "./scraper.js";
import { resolveBypass } from "./resolver.js";

if (!config.botToken) {
  console.error("❌ ERROR: BOT_TOKEN is not set in .env. Please configure your bot token.");
  process.exit(1);
}

export const bot = new Bot(config.botToken);
export const tracker = new PostTracker(config.siteUrl);

// URL cache for callback queries (ensures data stays <= 64 bytes)
const searchUrlMap = new Map();
let searchCounter = 1;
function registerSearchUrl(url) {
  const id = (searchCounter++).toString(36);
  searchUrlMap.set(id, url);
  if (searchUrlMap.size > 200) {
    const oldestKey = searchUrlMap.keys().next().value;
    searchUrlMap.delete(oldestKey);
  }
  return id;
}

export function escapeHtml(text) {
  return (text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function formatPostMessage(postData, autoResolve = true) {
  const { displayTitle, season } = parseTitle(postData.title);

  const lines = [
    `🎬 <b>${escapeHtml(displayTitle || postData.title)}</b>`,
    `━━━━━━━━━━━━━━━━━━━━`,
  ];

  const metaItems = [];
  if (postData.isSeries || season) {
    metaItems.push(`📌 <b>Type:</b> Series ${season ? `(${escapeHtml(season)})` : ""}`.trim());
  } else {
    metaItems.push(`📌 <b>Type:</b> Movie`);
  }

  if (postData.meta?.imdb) metaItems.push(`⭐ <b>IMDb:</b> ${escapeHtml(postData.meta.imdb)}`);
  if (postData.meta?.audio) metaItems.push(`🔊 <b>Audio:</b> ${escapeHtml(postData.meta.audio)}`);
  if (postData.meta?.genre) metaItems.push(`🎭 <b>Genre:</b> ${escapeHtml(postData.meta.genre)}`);

  lines.push(metaItems.join("\n"));

  if (postData.meta?.plot) {
    const plot = postData.meta.plot.length > 180 ? postData.meta.plot.slice(0, 177) + "…" : postData.meta.plot;
    lines.push(`\n📖 <b>Storyline:</b>\n<i>${escapeHtml(plot)}</i>`);
  }

  lines.push(`━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`⚡ <b>${postData.isSeries ? "Direct Episode Downloads" : "Select Download Quality"}:</b>`);

  const resolvedGroups = await Promise.all(
    postData.groups.map(async (item) => {
      if (!autoResolve) return { ...item, directUrl: item.url };
      try {
        const direct = await resolveBypass(item.url);
        return { ...item, directUrl: direct || item.url };
      } catch {
        return { ...item, directUrl: item.url };
      }
    })
  );

  const keyboard = new InlineKeyboard();
  let btnCount = 0;

  for (const item of resolvedGroups) {
    if (item.directUrl?.startsWith("http")) {
      keyboard.url(item.label, item.directUrl);
      btnCount++;
      if (btnCount % 2 === 0) keyboard.row();
    }
  }

  if (btnCount % 2 !== 0) keyboard.row();
  keyboard.row().url("🌐 View on Website", postData.url);

  return { text: lines.join("\n"), keyboard, poster: postData.poster };
}

export async function broadcastPost(chatId, postUrl) {
  try {
    const postData = await scrapePost(postUrl);
    if (!postData.groups.length) {
      console.log(`[Bot] No download links found in post: ${postUrl}`);
      return null;
    }

    console.log(`[Bot] Resolving & formatting: ${postData.title} (${postData.groups.length} links)…`);
    const { text, keyboard, poster } = await formatPostMessage(postData, config.autoResolve);

    if (poster && poster.startsWith("http")) {
      await bot.api.sendPhoto(chatId, poster, {
        caption: text.slice(0, 1024),
        parse_mode: "HTML",
        reply_markup: keyboard,
      });
    } else {
      await bot.api.sendMessage(chatId, text.slice(0, 4096), {
        parse_mode: "HTML",
        reply_markup: keyboard,
      });
    }
    console.log(`[Bot] Successfully posted: ${postData.title}`);
    return postData;
  } catch (err) {
    console.error(`[Bot] Failed to process post ${postUrl}:`, err.message);
    throw err;
  }
}

// Helpers for interactive commands & message handling
async function handlePublishPost(ctx, url) {
  const targetChat = config.channelId || ctx.chat.id;
  const waitMsg = await ctx.reply("⏳ Scraping post, resolving direct links & publishing…");
  try {
    const postData = await broadcastPost(targetChat, url);
    if (!postData) {
      return ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id, "⚠️ No download links found in this post.");
    }
    const { displayTitle } = parseTitle(postData.title);
    await ctx.api.editMessageText(
      ctx.chat.id,
      waitMsg.message_id,
      `✅ <b>Successfully published to ${config.channelId ? "Channel" : "Chat"}!</b>\n\n🎬 <b>${escapeHtml(displayTitle || postData.title)}</b>`,
      { parse_mode: "HTML" }
    );
  } catch (err) {
    await ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id, `❌ Failed: ${escapeHtml(err.message)}`);
  }
}

async function handleBypassLink(ctx, url) {
  const waitMsg = await ctx.reply("⏳ Bypassing link, please wait…");
  try {
    const directUrl = await resolveBypass(url);
    await ctx.api.editMessageText(
      ctx.chat.id,
      waitMsg.message_id,
      `✅ <b>Direct Download Link:</b>\n\n<code>${escapeHtml(directUrl)}</code>`,
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard().url("📥 Direct Download / Stream", directUrl),
      }
    );
  } catch (err) {
    await ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id, `❌ Bypass Failed: ${escapeHtml(err.message)}`);
  }
}

async function handleSearch(ctx, query) {
  const waitMsg = await ctx.reply(`🔍 Searching for "<b>${escapeHtml(query)}</b>"…`, { parse_mode: "HTML" });
  try {
    const results = await searchPosts(query, tracker.siteUrl || config.siteUrl);
    if (!results.length) {
      return ctx.api.editMessageText(
        ctx.chat.id,
        waitMsg.message_id,
        `❌ No results found for "<b>${escapeHtml(query)}</b>". Try another search term.`,
        { parse_mode: "HTML" }
      );
    }

    const lines = [`🔍 <b>Search Results for:</b> "<i>${escapeHtml(query)}</i>"\n`];
    const keyboard = new InlineKeyboard();

    results.slice(0, 5).forEach((item, idx) => {
      const num = idx + 1;
      const sInfo = item.season ? ` • <i>${escapeHtml(item.season)}</i>` : "";
      lines.push(`<b>${num}.</b> <b>${escapeHtml(item.displayTitle || item.rawTitle)}</b>${sInfo}`);

      const postKey = registerSearchUrl(item.url);
      keyboard
        .text(`📢 Post #${num}`, `pub:${postKey}`)
        .text(`⚡ Get Links #${num}`, `get:${postKey}`)
        .row();
    });

    lines.push(`\n━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`👇 <i>Click <b>📢 Post</b> to broadcast to channel or <b>⚡ Get Links</b> for DM!</i>`);

    await ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id, lines.join("\n"), {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  } catch (err) {
    await ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id, `❌ Search error: ${escapeHtml(err.message)}`);
  }
}

// Bot Commands
bot.command("start", (ctx) => {
  ctx.reply(
    `👋 <b>Welcome to DesireMovies Bypass & Tracker Bot!</b>\n\n` +
      `📌 <b>Monitored Site:</b> <code>${tracker.siteUrl || config.siteUrl}</code>\n` +
      `⏱ <b>Check Interval:</b> ${config.pollInterval}s\n` +
      `⚡ <b>Auto Bypass:</b> ${config.autoResolve ? "Enabled" : "Disabled"}\n\n` +
      `<b>How to use:</b>\n` +
      `• <b>🔍 Search Movie/Series:</b> Simply send any movie name (e.g. <code>Panchayat</code>) or <code>/search &lt;name&gt;</code>\n` +
      `• <b>📢 Publish URL:</b> Send any post link directly or use <code>/post &lt;url&gt;</code>\n` +
      `• <b>⚡ Bypass Gateway:</b> Send any download gateway link or use <code>/bypass &lt;url&gt;</code>\n\n` +
      `<b>Commands:</b>\n` +
      `• /search &lt;query&gt; - Search movies & TV series\n` +
      `• /check - Scan for latest releases immediately\n` +
      `• /status - Show current tracking status`,
    { parse_mode: "HTML" }
  );
});

bot.command("status", (ctx) => {
  ctx.reply(
    `📊 <b>Bot Status:</b>\n` +
      `• Site: <code>${tracker.siteUrl || config.siteUrl}</code>\n` +
      `• Channel: <code>${config.channelId || "Not Set"}</code>\n` +
      `• Cached Posts: ${tracker.seenUrls.size}\n` +
      `• Auto-Resolve Direct Links: ${config.autoResolve ? "YES" : "NO"}`,
    { parse_mode: "HTML" }
  );
});

bot.command("search", (ctx) => {
  const query = ctx.match?.trim();
  if (!query) return ctx.reply("⚠️ Usage: <code>/search &lt;movie/series name&gt;</code>\n\n💡 <i>Or simply type the movie name directly!</i>", { parse_mode: "HTML" });
  return handleSearch(ctx, query);
});

bot.command("bypass", (ctx) => {
  const url = ctx.match?.trim();
  if (!url) return ctx.reply("⚠️ Usage: <code>/bypass https://link...</code>", { parse_mode: "HTML" });
  return handleBypassLink(ctx, url);
});

bot.command("post", (ctx) => {
  const url = ctx.match?.trim();
  if (!url) return ctx.reply("⚠️ Usage: <code>/post https://desiremovies.../post-slug/</code>\n\n💡 <i>Or simply send the link directly in this chat!</i>", { parse_mode: "HTML" });
  return handlePublishPost(ctx, url);
});

bot.command("check", async (ctx) => {
  await ctx.reply("🔍 Checking for new posts…");
  const newPosts = await tracker.getNewPosts();
  if (!newPosts.length) return ctx.reply("✅ No new posts found right now.");

  await ctx.reply(`🎉 Found ${newPosts.length} new post(s)! Publishing…`);
  const targetChat = config.channelId || ctx.chat.id;
  for (const post of newPosts) {
    await broadcastPost(targetChat, post.url);
  }
});

// Callback queries for interactive search results
bot.callbackQuery(/^pub:(.+)$/, async (ctx) => {
  const id = ctx.match[1];
  const url = searchUrlMap.get(id);
  if (!url) {
    return ctx.answerCallbackQuery({ text: "⚠️ Search result expired. Please search again!", show_alert: true });
  }

  await ctx.answerCallbackQuery({ text: "⏳ Scraping & publishing to channel..." });
  const targetChat = config.channelId || ctx.chat.id;
  try {
    const postData = await broadcastPost(targetChat, url);
    if (postData) {
      const { displayTitle } = parseTitle(postData.title);
      await ctx.reply(`✅ <b>Published to ${config.channelId ? "Channel" : "Chat"}!</b>\n\n🎬 <b>${escapeHtml(displayTitle || postData.title)}</b>`, { parse_mode: "HTML" });
    } else {
      await ctx.reply("⚠️ <b>No active download links found in this post</b> (the links on the website might be expired or unavailable).", { parse_mode: "HTML" });
    }
  } catch (err) {
    await ctx.reply(`❌ Failed to publish: ${escapeHtml(err.message)}`);
  }
});

bot.callbackQuery(/^get:(.+)$/, async (ctx) => {
  const id = ctx.match[1];
  const url = searchUrlMap.get(id);
  if (!url) {
    return ctx.answerCallbackQuery({ text: "⚠️ Search result expired. Please search again!", show_alert: true });
  }

  await ctx.answerCallbackQuery({ text: "⏳ Fetching direct download links..." });
  try {
    const postData = await broadcastPost(ctx.chat.id, url);
    if (!postData) {
      await ctx.reply("⚠️ <b>No active download links found in this post</b> (the links on the website might be expired or unavailable).", { parse_mode: "HTML" });
    }
  } catch (err) {
    await ctx.reply(`❌ Failed to fetch links: ${escapeHtml(err.message)}`);
  }
});

// Auto-handle URLs or Search queries sent as messages
bot.on("message:text", async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith("/")) return;

  const urlMatch = text.match(/https?:\/\/[^\s]+/i);
  if (urlMatch) {
    const url = urlMatch[0];
    if (/desiremovies/i.test(url)) {
      await handlePublishPost(ctx, url);
    } else if (/^https?:\/\/[^/]*(?:gyanigurus|kmhd|moviesbaba|gdflix|goflix|katmoviehd|katdrama|hubcloud|hubdrive|gamerxyt|sportverse)/i.test(url)) {
      await handleBypassLink(ctx, url);
    }
    return;
  }

  // Treat plain text message as a movie/series search query
  await handleSearch(ctx, text);
});

// Automated Tracker Loop
async function startTrackerLoop() {
  console.log(`[Tracker] Initializing tracker for ${config.siteUrl}…`);
  await tracker.init();

  async function poll() {
    try {
      const newPosts = await tracker.getNewPosts();
      if (newPosts.length > 0) {
        console.log(`[Tracker] Discovered ${newPosts.length} new post(s)!`);
        if (config.channelId) {
          for (const post of newPosts) {
            await broadcastPost(config.channelId, post.url);
          }
        }
      }
    } catch (err) {
      console.error("[Tracker] Polling error:", err.message);
    }
  }

  await poll();
  setInterval(poll, config.pollInterval * 1000);
}

// Start bot & health check server if executed directly
if (process.argv[1]?.endsWith("index.js")) {
  const PORT = process.env.PORT || 3000;
  http
    .createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("DesireMovies Telegram Bot is running!\n");
    })
    .listen(PORT, () => {
      console.log(`🌐 Health-check server listening on port ${PORT}`);
    });

  bot.catch((err) => console.error("[Bot Middleware Error]", err));

  let trackerStarted = false;
  async function startBotWithRetry() {
    while (true) {
      try {
        await bot.start({
          drop_pending_updates: true,
          onStart: () => {
            console.log("🚀 Telegram Bot is running!");
            if (!trackerStarted) {
              trackerStarted = true;
              startTrackerLoop();
            }
          },
        });
        break;
      } catch (err) {
        if (err.description?.includes("Conflict") || err.error_code === 409) {
          console.warn("⚠️ Bot instance conflict (409). Old instance shutting down, retrying in 4s…");
          await new Promise((r) => setTimeout(r, 4000));
        } else {
          console.error("❌ Polling error, retrying in 5s:", err.message || err);
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    }
  }

  process.once("SIGINT", () => {
    console.log("Shutting down bot (SIGINT)...");
    bot.stop();
    process.exit(0);
  });

  process.once("SIGTERM", () => {
    console.log("Shutting down bot (SIGTERM)...");
    bot.stop();
    process.exit(0);
  });

  startBotWithRetry();
}
