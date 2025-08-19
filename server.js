import express from "express";
import fetch from "node-fetch";
import { Telegraf, Markup } from "telegraf";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);

const ALLOWED_CHAT_ID = process.env.ALLOWED_CHAT_ID;
const GAS_URL = process.env.GAS_URL;

const userState = {}; // store user progress

// ✅ Middleware: Only allowed user
bot.use((ctx, next) => {
  if (ctx.chat && ctx.chat.id.toString() !== ALLOWED_CHAT_ID) {
    return ctx.reply("⛔ You are not authorized to use this bot.");
  }
  return next();
});

// --- /start command
bot.start((ctx) => {
  ctx.reply("👋 Send me an Instagram Reel URL to start.");
  userState[ctx.chat.id] = { step: "waiting_reel" };
});

// --- Handle messages
bot.on("text", async (ctx) => {
  const chatId = ctx.chat.id;
  const text = ctx.message.text;

  if (!userState[chatId]) userState[chatId] = { step: "waiting_reel" };
  const state = userState[chatId];

  // Cancel command
  if (text.toLowerCase() === "cancel") {
    delete userState[chatId];
    return ctx.reply("❌ Cancelled.");
  }

  // Step: waiting for reel
  if (state.step === "waiting_reel") {
    if (!text.startsWith("http")) return ctx.reply("⚠️ Send a valid Instagram Reel URL.");
    state.reelUrl = text;
    state.step = "waiting_category";

    // Fetch categories from GAS
    try {
      const res = await fetch(GAS_URL, {
        method: "POST",
        body: JSON.stringify({ action: "getCategories" }),
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      const categories = data.categories || [];

      const buttons = categories.map((c) => [Markup.button.callback(c, `cat_${c}`)]);
      buttons.push([Markup.button.callback("➕ Add Category", "add_category")]);
      buttons.push([Markup.button.callback("❌ Cancel", "cancel")]);

      return ctx.reply("📂 Choose a category:", Markup.inlineKeyboard(buttons));
    } catch (err) {
      return ctx.reply("⚠️ Failed to fetch categories. Try again later.");
    }
  }

  // Step: adding category (waiting for name)
  if (state.step === "adding_category") {
    const categoryName = text.trim();
    if (!categoryName) return ctx.reply("⚠️ Please send a valid category name.");

    try {
      await fetch(GAS_URL, {
        method: "POST",
        body: JSON.stringify({ action: "addCategory", category: categoryName }),
        headers: { "Content-Type": "application/json" },
      });

      state.category = categoryName;
      state.step = "waiting_use_case";
      return ctx.reply(`✅ Category '${categoryName}' created. Now send the Use Case:`, Markup.inlineKeyboard([
        [Markup.button.callback("❌ Cancel", "cancel")]
      ]));
    } catch (err) {
      return ctx.reply("⚠️ Failed to create category. Try again.");
    }
  }

  // Step: waiting for Use Case
  if (state.step === "waiting_use_case") {
    state.useCase = text.trim();
    state.step = "waiting_extra";
    return ctx.reply("🔗 Send Extra URL (or type 'no'):", Markup.inlineKeyboard([
      [Markup.button.callback("❌ Cancel", "cancel")]
    ]));
  }

  // Step: waiting for Extra Link
  if (state.step === "waiting_extra") {
    state.extraLink = text.toLowerCase() === "no" ? "" : text.trim();

    // Save to Google Sheets
    try {
      await fetch(GAS_URL, {
        method: "POST",
        body: JSON.stringify({
          action: "saveReel",
          category: state.category,
          reelUrl: state.reelUrl,
          useCase: state.useCase,
          extraLink: state.extraLink,
        }),
        headers: { "Content-Type": "application/json" },
      });
      ctx.reply(`✅ Reel saved in '${state.category}' sheet!`);
    } catch (err) {
      ctx.reply("⚠️ Failed to save reel. Try again.");
    }

    // Reset state
    userState[chatId] = { step: "waiting_reel" };
    return ctx.reply("🎬 Send another Reel URL to continue or type /start to restart.");
  }
});

// --- Handle button clicks
bot.action(/cat_(.+)/, (ctx) => {
  const chatId = ctx.chat.id;
  const category = ctx.match[1];
  const state = userState[chatId];
  state.category = category;
  state.step = "waiting_use_case";
  ctx.reply("✏️ Enter a use case:", Markup.inlineKeyboard([
    [Markup.button.callback("❌ Cancel", "cancel")]
  ]));
});

bot.action("add_category", (ctx) => {
  const chatId = ctx.chat.id;
  const state = userState[chatId];
  state.step = "adding_category";
  ctx.reply("➕ Send the new category name:", Markup.inlineKeyboard([
    [Markup.button.callback("❌ Cancel", "cancel")]
  ]));
});

bot.action("cancel", (ctx) => {
  const chatId = ctx.chat.id;
  delete userState[chatId];
  ctx.reply("❌ Cancelled.");
});

// --- Launch bot
bot.launch();
app.get("/", (req, res) => res.send("Bot is running ✅"));
app.listen(10000, () => console.log("Server running on port 10000"));
