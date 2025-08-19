import express from "express";
import fetch from "node-fetch";
import { Telegraf, Markup } from "telegraf";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);

const ALLOWED_CHAT_ID = process.env.ALLOWED_CHAT_ID;
const GAS_URL = process.env.GAS_URL;

let userState = {}; // store temporary user progress

// ✅ Middleware for allowed user only
bot.use((ctx, next) => {
  if (ctx.chat && ctx.chat.id.toString() !== ALLOWED_CHAT_ID) {
    return ctx.reply("⛔ You are not authorized to use this bot.");
  }
  return next();
});

// /start command
bot.start((ctx) => {
  ctx.reply("👋 Send me an Instagram Reel URL to start.");
  userState[ctx.chat.id] = { step: "waiting_reel" };
});

// Handle messages
bot.on("text", async (ctx) => {
  const chatId = ctx.chat.id;
  const text = ctx.message.text;

  if (!userState[chatId]) userState[chatId] = { step: "waiting_reel" };

  const state = userState[chatId];

  if (state.step === "waiting_reel" && text.startsWith("http")) {
    state.reel = text;
    state.step = "waiting_category";

    // fetch categories from GAS
    const response = await fetch(`${GAS_URL}?action=getCategories`);
    const data = await response.json();

    const categories = data.categories || [];
    const buttons = categories.map((c) => [Markup.button.callback(c, `cat_${c}`)]);
    buttons.push([Markup.button.callback("➕ Add Category", "add_category")]);

    ctx.reply("📂 Choose a category:", Markup.inlineKeyboard(buttons));
  }
});

// Category selection
bot.action(/cat_(.+)/, (ctx) => {
  const chatId = ctx.chat.id;
  const category = ctx.match[1];
  userState[chatId].category = category;
  userState[chatId].step = "waiting_use_case";
  ctx.reply("✍️ Enter a use case:");
});

// Add category
bot.action("add_category", (ctx) => {
  const chatId = ctx.chat.id;
  userState[chatId].step = "adding_category";
  ctx.reply("➕ Send me the new category name:");
});

// Handle category creation
bot.on("text", async (ctx) => {
  const chatId = ctx.chat.id;
  const state = userState[chatId];
  const text = ctx.message.text;

  if (state.step === "adding_category") {
    await fetch(GAS_URL, {
      method: "POST",
      body: JSON.stringify({ action: "addCategory", name: text }),
      headers: { "Content-Type": "application/json" },
    });
    ctx.reply(`✅ Category '${text}' added! Now send a reel again.`);
    state.step = "waiting_reel";
  } else if (state.step === "waiting_use_case") {
    state.useCase = text;
    state.step = "waiting_extra_link";
    ctx.reply("🔗 Any extra link? (or type 'no')");
  } else if (state.step === "waiting_extra_link") {
    state.extraLink = text.toLowerCase() === "no" ? "" : text;

    // ✅ Save to Google Sheets
    await fetch(GAS_URL, {
      method: "POST",
      body: JSON.stringify({
        action: "saveReel",
        category: state.category,
        reel: state.reel,
        useCase: state.useCase,
        extraLink: state.extraLink,
      }),
      headers: { "Content-Type": "application/json" },
    });

    ctx.reply(`✅ Successfully added to '${state.category}' sheet!`);
    state.step = "waiting_reel";
  }
});

bot.launch();

// Express for Render healthcheck
app.get("/", (req, res) => res.send("Bot is running ✅"));

app.listen(10000, () => console.log("Server running on port 10000"));
