import { REST, Routes } from "discord.js";
import "dotenv/config";

const commands = [
  {
    name: "join",
    description: "Bot joins your current voice channel and starts transcribing",
  },
  {
    name: "leave",
    description: "Bot leaves the voice channel and stops transcribing",
  },
];

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

try {
  console.log("Registering slash commands...");
  await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), {
    body: commands,
  });
  console.log("Commands registered successfully.");
} catch (error) {
  console.error("Failed to register commands:", error);
}
