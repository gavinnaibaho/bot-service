import { Client } from "@discordjs/core";
import { REST } from "@discordjs/rest";
import { WebSocketManager } from "@discordjs/ws";
import { GatewayDispatchEvents, GatewayIntentBits, ActivityType, PresenceUpdateStatus } from "discord-api-types/v10";
import { initDb } from "./db";
import { shopCommandsPayload } from "./commands";
import { handleInteraction } from "./interaction";
import { handleVoiceInteraction, onGuildCreate, onVoiceStateUpdate } from "./tempvoice";

const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error("DISCORD_TOKEN belum diisi di .env");
// GUILD_ID opsional: kalau diisi, command didaftarkan ke server itu saja (langsung muncul, cocok untuk tes).
const guildId = process.env.GUILD_ID || null;

let applicationId = atob(token.split(".")[0]!);

process.on("uncaughtException", (err) => console.error(`Uncaught: ${err}`));
process.on("unhandledRejection", (reason) => console.error(`Unhandled rejection: ${reason}`));

await initDb();

const rest = new REST({ version: "10" }).setToken(token);
const gateway = new WebSocketManager({
    token,
    rest,
    // GuildVoiceStates (bukan privileged) untuk fitur Join to Create.
    intents: GatewayIntentBits.Guilds | GatewayIntentBits.GuildVoiceStates,
    initialPresence: {
        status: PresenceUpdateStatus.Online,
        since: null,
        afk: false,
        activities: [{ name: "𝘙𝘖𝘉𝘜𝘟 & 𝘎𝘐𝘎", type: ActivityType.Custom, state: "𝘙𝘖𝘉𝘜𝘟 & 𝘎𝘐𝘎" }],
    },
});
const client = new Client({ rest, gateway });

client.on(GatewayDispatchEvents.InteractionCreate, async ({ data, api }) => {
    try {
        if (await handleVoiceInteraction(api, data)) return;
        await handleInteraction({ data, api, applicationId });
    } catch (err) {
        console.error(`Error interaction: ${err}`);
    }
});

client.on(GatewayDispatchEvents.GuildCreate, ({ data, api }) => {
    try {
        onGuildCreate(api, data);
    } catch (err) {
        console.error(`Error GuildCreate: ${err}`);
    }
});

client.on(GatewayDispatchEvents.VoiceStateUpdate, async ({ data, api }) => {
    try {
        await onVoiceStateUpdate(api, data);
    } catch (err) {
        console.error(`Error VoiceStateUpdate: ${err}`);
    }
});

client.once(GatewayDispatchEvents.Ready, async ({ data, api }) => {
    applicationId = data.user.id;
    console.info(`✅ ${data.user.username} online`);
    try {
        if (guildId) {
            await api.applicationCommands.bulkOverwriteGuildCommands(applicationId, guildId, shopCommandsPayload);
            console.info(`Command didaftarkan ke server ${guildId}`);
        } else {
            await api.applicationCommands.bulkOverwriteGlobalCommands(applicationId, shopCommandsPayload);
            console.info("Command global didaftarkan (bisa butuh beberapa menit untuk muncul)");
        }
    } catch (err) {
        console.error(`Gagal mendaftarkan command: ${err}`);
    }
});

await gateway.connect();
