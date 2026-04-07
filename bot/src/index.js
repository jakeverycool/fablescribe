import {
  Client,
  GatewayIntentBits,
  Events,
  InteractionType,
} from "discord.js";
import {
  joinVoiceChannel,
  getVoiceConnection,
  entersState,
  VoiceConnectionStatus,
  EndBehaviorType,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
} from "@discordjs/voice";
import OpusScript from "opusscript";
import WebSocket from "ws";
import crypto from "crypto";
import http from "http";
import { Readable } from "stream";
import "dotenv/config";

import { downsample48kStereoTo16kMono } from "./audio-processor.js";

const BACKEND_WS_URL = process.env.BACKEND_WS_URL;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
});

// ── Per-guild session state ─────────────────────────────────────────────────
const sessions = new Map(); // guildId → { sessionId, ws, connection, receivers }

// ── Opus decoder cache (one per user) ───────────────────────────────────────
const decoders = new Map(); // odecKey → OpusEncoder

function getDecoder(userId) {
  if (!decoders.has(userId)) {
    // Discord sends 48kHz stereo Opus
    decoders.set(
      userId,
      new OpusScript(48000, 2, OpusScript.Application.AUDIO)
    );
  }
  return decoders.get(userId);
}

// ── Slash command handler ───────────────────────────────────────────────────
client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.type !== InteractionType.ApplicationCommand) return;

  try {
    if (interaction.commandName === "join") {
      await handleJoin(interaction);
    } else if (interaction.commandName === "leave") {
      await handleLeave(interaction);
    }
  } catch (err) {
    console.error("Interaction error:", err.message);
  }
});

async function handleJoin(interaction) {
  const member = interaction.member;
  const voiceChannel = member?.voice?.channel;

  if (!voiceChannel) {
    await interaction.reply({
      content: "You need to be in a voice channel first.",
      flags: 64,
    });
    return;
  }

  // Check if already in a session for this guild
  if (sessions.has(interaction.guildId)) {
    await interaction.reply({
      content: "Already transcribing in this server. Use /leave first.",
      flags: 64,
    });
    return;
  }

  await interaction.deferReply({ flags: 64 });

  const sessionId = crypto.randomUUID();

  // Connect to backend WebSocket
  let ws;
  try {
    ws = new WebSocket(`${BACKEND_WS_URL}?session_id=${sessionId}&secret=${process.env.BOT_SECRET}`);
    await new Promise((resolve, reject) => {
      ws.on("open", resolve);
      ws.on("error", reject);
      setTimeout(() => reject(new Error("Backend connection timeout")), 5000);
    });
  } catch (err) {
    console.error("Failed to connect to backend:", err.message);
    await interaction.editReply(
      "Failed to connect to the transcription backend. Is it running?"
    );
    return;
  }

  // Join voice channel
  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: interaction.guildId,
    adapterCreator: interaction.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: true,
  });

  const receivers = new Map();

  const session = { sessionId, ws, connection, receivers };
  sessions.set(interaction.guildId, session);

  // Listen for users speaking
  const receiver = connection.receiver;

  receiver.speaking.on("start", (userId) => {
    if (receivers.has(userId)) return; // Already receiving

    const opusStream = receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: 1000,
      },
    });

    receivers.set(userId, opusStream);

    // Resolve the display name
    const guild = client.guilds.cache.get(interaction.guildId);
    const memberObj = guild?.members.cache.get(userId);
    const displayName =
      memberObj?.displayName || memberObj?.user?.username || userId;

    const decoder = getDecoder(userId);

    opusStream.on("data", (opusPacket) => {
      try {
        // Decode Opus → 48kHz stereo PCM (960 frames per 20ms at 48kHz)
        const pcm48k = Buffer.from(decoder.decode(opusPacket));
        // Downsample → 16kHz mono PCM
        const pcm16k = downsample48kStereoTo16kMono(pcm48k);

        // Send metadata frame then audio frame
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: "audio_meta",
              user_id: userId,
              display_name: displayName,
              session_id: sessionId,
              chunk_ts: new Date().toISOString(),
            })
          );
          ws.send(pcm16k);
        }
      } catch (err) {
        // Decode errors on partial packets are normal at stream start/end
      }
    });

    opusStream.on("end", () => {
      receivers.delete(userId);
    });
  });

  // Handle voice connection state changes — allow reconnection before cleanup
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      // Give Discord 5 seconds to reconnect before giving up
      await entersState(connection, VoiceConnectionStatus.Ready, 5_000);
    } catch {
      console.log("Voice connection lost, cleaning up");
      cleanupSession(interaction.guildId);
    }
  });

  console.log(
    `Joined ${voiceChannel.name} in ${interaction.guild.name}, session ${sessionId}`
  );
  await interaction.editReply(
    `Joined **${voiceChannel.name}** — transcription is live.`
  );
}

async function handleLeave(interaction) {
  const session = sessions.get(interaction.guildId);
  if (!session) {
    await interaction.reply({
      content: "Not currently in a voice channel.",
      flags: 64,
    });
    return;
  }

  cleanupSession(interaction.guildId);
  await interaction.reply({ content: "Left voice channel. Session ended.", flags: 64 });
}

function cleanupSession(guildId) {
  const session = sessions.get(guildId);
  if (!session) return;

  // Close all audio receivers
  for (const [, stream] of session.receivers) {
    stream.destroy();
  }
  session.receivers.clear();

  // Close backend WebSocket
  if (
    session.ws.readyState === WebSocket.OPEN ||
    session.ws.readyState === WebSocket.CONNECTING
  ) {
    session.ws.close();
  }

  // Disconnect from voice
  try {
    session.connection.destroy();
  } catch {
    // Already destroyed
  }

  sessions.delete(guildId);
  console.log(`Session ${session.sessionId} cleaned up for guild ${guildId}`);
}

// ── Graceful shutdown ───────────────────────────────────────────────────────
process.on("SIGINT", () => {
  console.log("Shutting down...");
  for (const guildId of sessions.keys()) {
    cleanupSession(guildId);
  }
  client.destroy();
  process.exit(0);
});

// ── Audio Playback ──────────────────────────────────────────────────────────

async function playAudioInGuild(guildId, audioUrl) {
  // If "any", use the first active session
  let session;
  if (guildId === "any") {
    session = sessions.values().next().value;
  } else {
    session = sessions.get(guildId);
  }
  if (!session) {
    console.error("No active session for playback");
    return false;
  }

  try {
    // Fetch the audio file
    const resp = await fetch(audioUrl);
    if (!resp.ok) throw new Error(`Failed to fetch audio: ${resp.status}`);

    const arrayBuffer = await resp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Create a readable stream from the buffer
    const stream = new Readable();
    stream.push(buffer);
    stream.push(null);

    // Create audio player and resource
    const player = createAudioPlayer();
    const resource = createAudioResource(stream);

    // Subscribe the connection to the player
    session.connection.subscribe(player);

    // Play
    player.play(resource);

    return new Promise((resolve) => {
      player.on(AudioPlayerStatus.Idle, () => {
        resolve(true);
      });
      player.on("error", (error) => {
        console.error("Playback error:", error.message);
        resolve(false);
      });
      // Timeout after 60 seconds
      setTimeout(() => resolve(false), 60000);
    });
  } catch (err) {
    console.error("Error playing audio:", err.message);
    return false;
  }
}

// ── HTTP Server for backend commands ────────────────────────────────────────

const BOT_HTTP_PORT = 3001;

const httpServer = http.createServer(async (req, res) => {
  // Only accept POST /play
  if (req.method === "POST" && req.url === "/play") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { guild_id, audio_url } = JSON.parse(body);

        // Verify bot secret
        const authHeader = req.headers["authorization"] || "";
        if (authHeader !== `Bearer ${process.env.BOT_SECRET}`) {
          res.writeHead(401);
          res.end(JSON.stringify({ error: "Unauthorized" }));
          return;
        }

        if (!guild_id || !audio_url) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "Missing guild_id or audio_url" }));
          return;
        }

        console.log(`Playing audio in guild ${guild_id}`);
        const success = await playAudioInGuild(guild_id, audio_url);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success }));
      } catch (err) {
        console.error("Play request error:", err.message);
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  } else if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", sessions: sessions.size }));
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

httpServer.listen(BOT_HTTP_PORT, "127.0.0.1", () => {
  console.log(`Bot HTTP server listening on port ${BOT_HTTP_PORT}`);
});

// ── Start ───────────────────────────────────────────────────────────────────
client.once(Events.ClientReady, (c) => {
  console.log(`Bot logged in as ${c.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);
