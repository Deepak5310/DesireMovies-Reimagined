import "dotenv/config";

export const config = {
  botToken: process.env.BOT_TOKEN || "",
  channelId: process.env.CHANNEL_ID || "",
  siteUrl: (process.env.SITE_URL || "https://desiremovies.party").replace(/\/+$/, ""),
  pollInterval: Math.max(30, parseInt(process.env.POLL_INTERVAL || "120", 10)),
  autoResolve: process.env.AUTO_RESOLVE !== "false",
};
