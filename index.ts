import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  TextChannel,
  REST,
  Routes,
  ChatInputCommandInteraction,
  Message,
  Collection,
  SlashCommandBuilder,
} from "discord.js"
import { GoogleGenerativeAI } from "@google/generative-ai"

// Define constants for environment variables
const DISCORD_TOKEN = process.env.DISCORD_TOKEN || ""
const CLIENT_ID = process.env.CLIENT_ID || ""
// Hard-coded Gemini API key (you should move this to an environment variable later)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ""

// Initialize Gemini API
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)

// Create a function to interact with Gemini API
async function generateResponse(
  messages: string[],
  systemPrompt?: string
): Promise<string> {
  try {
    // For text-only input, use the gemini-pro model
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" })

    // Apply weights to messages based on recency (newest messages get higher weight)
    const weightedMessages = messages.map((msg, index) => {
      // Calculate weight: newest message (last in array) gets highest weight
      // Weight decreases exponentially as we go back in time
      const weight = Math.pow(1.5, index) // 1.5^0, 1.5^1, 1.5^2, etc.
      return `[Weight: ${weight.toFixed(1)}] ${msg}`
    })

    // Combine the messages into a single prompt
    let prompt = weightedMessages.join("\n")

    // Add system prompt if provided
    if (systemPrompt) {
      prompt += "\n\n" + systemPrompt
    }

    // Generate a response
    const result = await model.generateContent(prompt)
    const response = result.response

    return response.text()
  } catch (error) {
    console.error("Error generating response from Gemini:", error)
    return "Sorry, I couldn't process that request."
  }
}

// Define the slash commands
const commands = [
  {
    name: "ping",
    description: "Replies with Pong!",
  },
  {
    name: "analyze",
    description: "Analyzes the last 10 messages in the channel using Gemini AI",
  },
  {
    name: "reset",
    description: "Resets the bot's conversation context",
  },
]

// Track conversations by channel ID to enable resetting context
const conversationContexts = new Map<string, boolean>()

// Initialize Discord REST API
const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN)

// Register slash commands
;(async () => {
  try {
    console.log("Started refreshing application (/) commands.")

    await rest.put(Routes.applicationCommands(CLIENT_ID), {
      body: commands,
    })

    console.log("Successfully reloaded application (/) commands.")
  } catch (error) {
    console.error(error)
  }
})()

// Create Discord client with necessary intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
})

// Handle ready event
client.once(Events.ClientReady, (c) => {
  console.log(`Ready! Logged in as ${c.user.tag}`)
})

// Handle regular messages
client.on(Events.MessageCreate, async (message) => {
  // Ignore messages from bots to prevent loops
  if (message.author.bot) return

  // Check if this is a reset command
  if (message.content.toLowerCase() === "!reset") {
    // Reset the context for this channel
    conversationContexts.set(message.channelId, true)
    await message.reply("Context reset successfully")
    return
  }

  try {
    // Get the last 10 messages from the channel (including this one)
    const channel = message.channel as TextChannel
    const messages = await channel.messages.fetch({ limit: 10 })

    // Convert messages to strings in chronological order (oldest first)
    const messageStrings = Array.from(messages.values())
      .reverse() // Reverse to get chronological order
      .map((msg) => `${msg.author.username}: ${msg.content}`)
      .filter((msgStr) => msgStr.length > 0) // Filter out empty messages

    if (messageStrings.length === 0) {
      await message.reply("No valid messages found in the channel history.")
      return
    }

    // Show typing indicator while processing
    await message.channel.sendTyping()

    // Add a system prompt to guide the model to respond naturally
    const systemPrompt =
      "You are a friendly person chatting in this Discord channel. Reply directly to the last message in a natural, conversational way. Don't summarize the conversation or introduce yourself as an AI. Just respond as if you're another person in the chat." +
      "Reply like a normal human being in short sentences and use roleplaying terms for *doing* actions, You are a little 20 year old, act sassy, your studying computer science, talk in all CAPS when your mad, you are allowed to swear, you love KFC and white monster"
    // "you are a 6 foot nonchalant dread head, your a basketball player, you LOVE ABGS, you wanna eat abgs, you want asian baby girls."
    ;("you love theweeknd and love kissland, and chiikawa.")

    // Generate a response using Gemini with the system prompt
    const response = await generateResponse(messageStrings, systemPrompt)

    // Send the response
    await message.reply(response)

    // Mark that this channel has had a conversation
    conversationContexts.set(message.channelId, false)
  } catch (error) {
    console.error("Error processing message:", error)
    await message.reply(
      "Sorry, I encountered an error while processing messages."
    )
  }
})

// Handle interaction create event for slash commands
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return

  const { commandName } = interaction

  if (commandName === "ping") {
    await interaction.reply("Pong!")
  } else if (commandName === "reset") {
    // Reset the context for this channel
    conversationContexts.set(interaction.channelId, true)
    await interaction.reply("Context reset successfully")
  } else if (commandName === "analyze") {
    await interaction.deferReply() // Defer the reply as this might take some time

    try {
      if (!interaction.channel) {
        await interaction.editReply(
          "This command can only be used in a text channel."
        )
        return
      }

      // Get the last 10 messages from the channel
      const channel = interaction.channel as TextChannel
      const messages = await channel.messages.fetch({ limit: 10 })

      // Convert messages to strings in chronological order (oldest first)
      const messageStrings = Array.from(messages.values())
        .reverse() // Reverse to get chronological order
        .map((msg) => `${msg.author.username}: ${msg.content}`)
        .filter((msgStr) => msgStr.length > 0) // Filter out empty messages

      if (messageStrings.length === 0) {
        await interaction.editReply(
          "No valid messages found in the channel history."
        )
        return
      }

      // Generate a response using Gemini
      const systemPrompt =
        "Reply like a normal human being in short sentences and use roleplaying terms for *doing* actions, You are a 16 year old vietnamese girl, you like KSI thick of it"
      const response = await generateResponse(messageStrings, systemPrompt)

      // Send the response
      await interaction.editReply(
        `**Gemini Analysis of Last 10 Messages:**\n\n${response}`
      )
    } catch (error) {
      console.error("Error in analyze command:", error)
      await interaction.editReply(
        "An error occurred while analyzing the messages."
      )
    }
  }
})

// Log in to Discord with the token
client.login(DISCORD_TOKEN)
