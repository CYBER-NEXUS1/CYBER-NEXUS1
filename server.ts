import express from "express";
import { createServer as createViteServer } from "vite";
import makeWASocket, { 
    DisconnectReason, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    WAMessageContent,
    MessageUpsertType,
    proto,
    Browsers
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import qrcode from "qrcode";
import pino from "pino";
import path from "path";
import fs from "fs";

import { GoogleGenAI } from "@google/genai";

const app = express();
const PORT = 3000;

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Bot State
let qrCode: string | null = null;
let pairingCode: string | null = null;
let connectionStatus: "connecting" | "open" | "close" = "close";
let botInfo = {
    runtime: Date.now(),
    prefix: ".",
    status: "Offline"
};

// Spam Tracker
const spamTracker = new Map<string, number[]>();

// Settings
const settings = {
    autoread: false,
    autotyping: false,
    autorecording: false,
    autoreact: false,
    autoapprove: false,
    alwaysonline: false,
    autoviewstatus: false,
    antilink: false,
    antispam: false,
    antimention: false,
    antitag: false,
    welcome: false,
    goodbye: false
};

let socket: any = null;

async function startWhatsApp(phoneNumber?: string) {
    // Ensure only one socket is active
    if (socket) {
        try { socket.end(); } catch (e) {}
        socket = null;
    }

    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
        },
        logger: pino({ level: 'silent' }),
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    socket = sock;

    if (phoneNumber && !sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                // Clear any existing pairing code before requesting new one
                pairingCode = null;
                // Ensure we are using the correct phone number format
                const code = await sock.requestPairingCode(phoneNumber);
                pairingCode = code;
                console.log(`[SYSTEM] Pairing code generated for ${phoneNumber}: ${code}`);
            } catch (err) {
                console.error('[ERROR] Failed to request pairing code:', err);
                pairingCode = "ERROR_RETRY";
            }
        }, 5000); // Increased delay for better stability
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('group-participants.update', async (anu) => {
        if (!settings.welcome && !settings.goodbye) return;
        try {
            const metadata = await sock.groupMetadata(anu.id);
            const participants = anu.participants;
            for (let participant of participants) {
                const num = (participant as any).id || participant;
                if (anu.action === 'add' && settings.welcome) {
                    const welcomeMsg = `Welcome @${num.split('@')[0]} to ${metadata.subject}! 👋`;
                    await sock.sendMessage(anu.id, { text: welcomeMsg, mentions: [num] });
                } else if (anu.action === 'remove' && settings.goodbye) {
                    const goodbyeMsg = `Goodbye @${num.split('@')[0]}! We'll miss you. 👋`;
                    await sock.sendMessage(anu.id, { text: goodbyeMsg, mentions: [num] });
                }
            }
        } catch (err) {
            console.error(err);
        }
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrCode = await qrcode.toDataURL(qr);
            pairingCode = null;
        }

        if (connection === 'close') {
            connectionStatus = "close";
            botInfo.status = "Offline";
            const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                startWhatsApp();
            }
        } else if (connection === 'open') {
            connectionStatus = "open";
            botInfo.status = "Online";
            qrCode = null;
            pairingCode = null;
            console.log('opened connection');
            
            // Send welcome message to bot owner
            try {
                const welcomeMsg = `*CYBER NEXUS CONNECTED SUCCESSFULLY* 🚀\n\nPrefix: ${botInfo.prefix}\nType *.menu* to see all commands.\n\n_System is now active and monitoring._`;
                await sock.sendMessage(sock.user?.id!, { text: welcomeMsg });
            } catch (err) {
                console.error('Failed to send welcome message:', err);
            }

            // Always Online
            if (settings.alwaysonline) {
                await sock.sendPresenceUpdate('available');
            }

            // Periodically refresh presence if alwaysonline is on
            setInterval(async () => {
                if (settings.alwaysonline && connectionStatus === 'open') {
                    await sock.sendPresenceUpdate('available');
                }
            }, 30000);
        }
    });

    // Auto View Status
    sock.ev.on('messages.upsert', async (m) => {
        if (settings.autoviewstatus && m.messages[0].key.remoteJid === 'status@broadcast') {
            await sock.readMessages([m.messages[0].key]);
        }
    });

    (sock.ev as any).on('group-request.update', async (anu: any) => {
        if (settings.autoapprove) {
            try {
                for (let participant of anu.participants) {
                    await sock.groupRequestParticipantsUpdate(anu.id, [participant], 'approve');
                }
            } catch (err) {
                console.error('Auto Approve Error:', err);
            }
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;
        const msg = m.messages[0];
        if (!msg.message) return;
        if (msg.key.fromMe) return;

        const from = msg.key.remoteJid!;
        const type = Object.keys(msg.message)[0];
        const body = (type === 'conversation') ? msg.message.conversation : 
                     (type === 'extendedTextMessage') ? msg.message.extendedTextMessage?.text : 
                     (type === 'imageMessage') ? msg.message.imageMessage?.caption : 
                     (type === 'videoMessage') ? msg.message.videoMessage?.caption : '';
        
        // Auto Approve (Auto Accept Group Invites) - Removed as per user request to change functionality
        
        if (!body?.startsWith(botInfo.prefix)) {
            // Anti-link logic
            if (settings.antilink && from.endsWith('@g.us') && body?.includes('chat.whatsapp.com/')) {
                const groupMetadata = await sock.groupMetadata(from);
                const botId = sock.user?.id.split(':')[0] + '@s.whatsapp.net';
                const isBotAdmin = groupMetadata.participants.find(p => p.id === botId)?.admin;
                
                if (isBotAdmin) {
                    await sock.sendMessage(from, { text: '🚫 Link detected! Removing user...' });
                    await sock.groupParticipantsUpdate(from, [msg.key.participant!], 'remove');
                }
            }
            return;
        }

        const args = body.slice(botInfo.prefix.length).trim().split(/ +/);
        const command = args.shift()?.toLowerCase();

        // Auto Read
        if (settings.autoread) {
            await sock.readMessages([msg.key]);
        }

        // Auto Typing/Recording
        if (settings.autotyping) {
            await sock.sendPresenceUpdate('composing', from);
        } else if (settings.autorecording) {
            await sock.sendPresenceUpdate('recording', from);
        }

        const isGroup = from.endsWith('@g.us');
        const sender = msg.key.participant || from;
        const pushname = msg.pushName || 'User';

        // Group Helpers
        let groupMetadata: any = null;
        let groupParticipants: any[] = [];
        let groupAdmins: string[] = [];
        let isBotAdmin = false;
        let isAdmins = false;

        if (isGroup) {
            groupMetadata = await sock.groupMetadata(from);
            groupParticipants = groupMetadata.participants;
            groupAdmins = groupParticipants.filter(p => p.admin).map(p => p.id);
            isBotAdmin = groupAdmins.includes(sock.user?.id.split(':')[0] + '@s.whatsapp.net');
            isAdmins = groupAdmins.includes(sender);
        }

        // Auto React
        if (settings.autoreact && !msg.key.fromMe) {
            const emojis = ['👍', '❤️', '😂', '😮', '😢', '🔥', '👏', '🎉'];
            const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
            await sock.sendMessage(from, { react: { text: randomEmoji, key: msg.key } });
        }

        // Protections (Non-command messages)
        if (!body?.startsWith(botInfo.prefix) && isGroup && !isAdmins) {
            // Anti-spam
            if (settings.antispam) {
                const now = Date.now();
                const userSpam = spamTracker.get(sender) || [];
                const recentSpam = userSpam.filter(t => now - t < 5000); // 5 seconds window
                recentSpam.push(now);
                spamTracker.set(sender, recentSpam);

                if (recentSpam.length > 5) { // More than 5 messages in 5 seconds
                    if (isBotAdmin) {
                        await sock.sendMessage(from, { text: '🚫 Spam detected! Removing user...' });
                        await sock.groupParticipantsUpdate(from, [sender], 'remove');
                        spamTracker.delete(sender);
                        return;
                    }
                }
            }

            // Anti-link
            if (settings.antilink && body?.includes('chat.whatsapp.com/')) {
                if (isBotAdmin) {
                    await sock.sendMessage(from, { text: '🚫 Link detected! Removing user...' });
                    await sock.groupParticipantsUpdate(from, [sender], 'remove');
                }
            }
            // Anti-tag (Tagging everyone)
            if (settings.antitag && (body?.includes('@everyone') || body?.includes('@here'))) {
                if (isBotAdmin) {
                    await sock.sendMessage(from, { text: '🚫 Tagging everyone is not allowed!' });
                    await sock.groupParticipantsUpdate(from, [sender], 'remove');
                }
            }
            // Anti-mention (Mentioning admins)
            if (settings.antimention) {
                const mentionedJid = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                const mentionsAdmins = mentionedJid.some(jid => groupAdmins.includes(jid));
                if (mentionsAdmins && isBotAdmin) {
                    await sock.sendMessage(from, { text: '🚫 Mentioning admins is restricted!' });
                    await sock.groupParticipantsUpdate(from, [sender], 'remove');
                }
            }
        }

        if (!body?.startsWith(botInfo.prefix)) return;

        switch (command) {
            case 'ai':
            case 'gpt':
            case 'bot':
                const prompt = args.join(' ');
                if (!prompt) return sock.sendMessage(from, { text: 'Please provide a question or prompt.' });
                
                try {
                    await sock.sendPresenceUpdate('composing', from);
                    const result = await ai.models.generateContent({
                        model: "gemini-2.0-flash",
                        contents: [{ parts: [{ text: prompt }] }]
                    });
                    await sock.sendMessage(from, { text: result.text || 'No response from AI.' }, { quoted: msg });
                } catch (err) {
                    console.error('Gemini Error:', err);
                    await sock.sendMessage(from, { text: 'Sorry, I encountered an error processing your request.' });
                }
                break;

            case 'ping':
                await sock.sendMessage(from, { text: 'Pong! 🏓' }, { quoted: msg });
                break;

            case 'status':
                const statusText = `╭━━〔 📊 BOT STATUS 〕━━┈⊷
┃ ⚡ Connection: ${connectionStatus}
┃ ⏱ Runtime: ${formatRuntime(Date.now() - botInfo.runtime)}
┃ 👥 Groups: ${(await sock.groupFetchAllParticipating()).length}
┃ 👤 User: ${sock.user?.name || 'Cyber Nexus'}
╰━━━━━━━━━━━━━━━┈⊷`;
                await sock.sendMessage(from, { text: statusText }, { quoted: msg });
                break;

            case 'restart':
                if (!isAdmins && from !== sock.user?.id) return sock.sendMessage(from, { text: 'This command is for admins only.' });
                await sock.sendMessage(from, { text: '🔄 Restarting bot...' });
                process.exit(0); // The process manager will restart it
                break;

            case 'menu':
                const uptime = formatRuntime(Date.now() - botInfo.runtime);
                const menuText = `╭━━〔 ⚡ CYBER NEXUS 〕━━┈⊷
┃ ⏱ Runtime: ${uptime}
┃ ⚡ Status: ${botInfo.status}
┃ 🔣 Prefix: ${botInfo.prefix}
┃ 👤 Owner: ${sock.user?.name || 'User'}
╰━━━━━━━━━━━━━━━┈⊷

╭━━〔 🤖 AI COMMANDS 〕━━┈⊷
┃ .ai [prompt]
┃ .gpt [prompt]
┃ .bot [prompt]

╭━━〔 👤 GENERAL COMMANDS 〕━━┈⊷
┃ ┃ .menu
┃ ┃ .ping
┃ ┃ .status
┃ ┃ .restart
╰━━━━━━━━━━━━━━━┈⊷

╭━━〔 ⚙️ AUTO SYSTEM 〕━━┈⊷
┃ .autoread on/off
┃ .autotyping on/off
┃ .autorecording on/off
┃ .autoreact on/off
┃ .autoapprove on/off
┃ .alwaysonline on/off
┃ .autoviewstatus on/off
╰━━━━━━━━━━━━━━━┈⊷

╭━━〔 👥 GROUP COMMANDS 〕━━┈⊷
┃ .add [number]
┃ .kick [reply/mention]
┃ .promote [reply/mention]
┃ .demote [reply/mention]
┃ .tagall
┃ .hidetag [text]
┃ .linkgc
┃ .leave
┃ .mute / closegroup
┃ .unmute / opengroup
┃ .welcome on/off
┃ .goodbye on/off
╰━━━━━━━━━━━━━━━┈⊷

╭━━〔 🛡 PROTECTION COMMANDS 〕━━┈⊷
┃ .antilink on/off
┃ .antispam on/off
┃ .antimention on/off
┃ .antitag on/off`;
                await sock.sendMessage(from, { text: menuText }, { quoted: msg });
                break;

            // Group Management
            case 'promote':
            case 'demote':
            case 'kick':
                if (!isGroup) return sock.sendMessage(from, { text: 'This command can only be used in groups.' });
                if (!isAdmins) return sock.sendMessage(from, { text: 'This command is for admins only.' });
                if (!isBotAdmin) return sock.sendMessage(from, { text: 'I need to be an admin to perform this action.' });

                const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || 
                             msg.message?.extendedTextMessage?.contextInfo?.participant;
                if (!target) return sock.sendMessage(from, { text: 'Please reply to a message or mention a user.' });
                
                if (command === 'kick' && groupAdmins.includes(target)) {
                    return sock.sendMessage(from, { text: 'I cannot kick an admin.' });
                }

                const action = command === 'promote' ? 'promote' : command === 'demote' ? 'demote' : 'remove';
                await sock.groupParticipantsUpdate(from, [target], action);
                await sock.sendMessage(from, { text: `✅ Successfully ${command === 'kick' ? 'removed' : command + 'd'} user.` });
                break;

            case 'add':
                if (!isGroup) return sock.sendMessage(from, { text: 'This command can only be used in groups.' });
                if (!isAdmins) return sock.sendMessage(from, { text: 'This command is for admins only.' });
                if (!isBotAdmin) return sock.sendMessage(from, { text: 'I need to be an admin to perform this action.' });

                const numToAdd = args[0]?.replace(/[^0-9]/g, '');
                if (!numToAdd) return sock.sendMessage(from, { text: 'Usage: .add 234xxx' });
                try {
                    await sock.groupParticipantsUpdate(from, [`${numToAdd}@s.whatsapp.net`], 'add');
                    await sock.sendMessage(from, { text: `✅ Successfully added user.` });
                } catch (err) {
                    await sock.sendMessage(from, { text: `❌ Failed to add user. They might have privacy settings enabled.` });
                }
                break;

            case 'mute':
            case 'closegroup':
                if (!isGroup) return sock.sendMessage(from, { text: 'This command can only be used in groups.' });
                if (!isAdmins) return sock.sendMessage(from, { text: 'This command is for admins only.' });
                if (!isBotAdmin) return sock.sendMessage(from, { text: 'I need to be an admin to perform this action.' });

                await sock.groupSettingUpdate(from, 'announcement');
                await sock.sendMessage(from, { text: '🔒 Group closed. Only admins can send messages.' });
                break;

            case 'unmute':
            case 'opengroup':
                if (!isGroup) return sock.sendMessage(from, { text: 'This command can only be used in groups.' });
                if (!isAdmins) return sock.sendMessage(from, { text: 'This command is for admins only.' });
                if (!isBotAdmin) return sock.sendMessage(from, { text: 'I need to be an admin to perform this action.' });

                await sock.groupSettingUpdate(from, 'not_announcement');
                await sock.sendMessage(from, { text: '🔓 Group opened. Everyone can send messages.' });
                break;

            case 'linkgc':
                if (!isGroup) return sock.sendMessage(from, { text: 'This command can only be used in groups.' });
                if (!isBotAdmin) return sock.sendMessage(from, { text: 'I need to be an admin to get the invite link.' });
                const inviteCode = await sock.groupInviteCode(from);
                await sock.sendMessage(from, { text: `🔗 Group Link: https://chat.whatsapp.com/${inviteCode}` });
                break;

            case 'leave':
                if (!isGroup) return sock.sendMessage(from, { text: 'This command can only be used in groups.' });
                if (!isAdmins) return sock.sendMessage(from, { text: 'This command is for admins only.' });
                await sock.sendMessage(from, { text: 'Goodbye! 👋' });
                await sock.groupLeave(from);
                break;

            case 'hidetag':
                if (!isGroup) return sock.sendMessage(from, { text: 'This command can only be used in groups.' });
                if (!isAdmins) return sock.sendMessage(from, { text: 'This command is for admins only.' });
                const hidetagText = args.join(' ') || '';
                await sock.sendMessage(from, { text: hidetagText, mentions: groupParticipants.map(a => a.id) });
                break;

            case 'tagall':
                if (!isGroup) return sock.sendMessage(from, { text: 'This command can only be used in groups.' });
                if (!isAdmins) return sock.sendMessage(from, { text: 'This command is for admins only.' });
                let tagText = `*TAG ALL*\n\n`;
                for (let mem of groupParticipants) {
                    tagText += `@${mem.id.split('@')[0]}\n`;
                }
                await sock.sendMessage(from, { text: tagText, mentions: groupParticipants.map(a => a.id) });
                break;

            // Auto Systems & Protection
            case 'autoread':
            case 'autotyping':
            case 'autorecording':
            case 'autoreact':
            case 'autoapprove':
            case 'alwaysonline':
            case 'autoviewstatus':
            case 'antilink':
            case 'antispam':
            case 'antimention':
            case 'antitag':
            case 'welcome':
            case 'goodbye':
                const toggle = args[0]?.toLowerCase();
                if (toggle === 'on') {
                    (settings as any)[command] = true;
                    await sock.sendMessage(from, { text: `✅ ${command} has been turned ON` }, { quoted: msg });
                } else if (toggle === 'off') {
                    (settings as any)[command] = false;
                    await sock.sendMessage(from, { text: `❌ ${command} has been turned OFF` }, { quoted: msg });
                } else {
                    await sock.sendMessage(from, { text: `Usage: .${command} on/off` }, { quoted: msg });
                }
                break;

            default:
                break;
        }
    });
}

function formatRuntime(ms: number) {
    let s = Math.floor(ms / 1000);
    let m = Math.floor(s / 60);
    s %= 60;
    let h = Math.floor(m / 60);
    m %= 60;
    let d = Math.floor(h / 24);
    h %= 24;

    return `${d > 0 ? d + 'd ' : ''}${h} hours, ${m} minutes, ${s} seconds`;
}

async function startServer() {
    app.use(express.json());

    // Health Check
    app.get("/health", (req, res) => {
        res.json({ status: "ok", connectionStatus });
    });

    // API Routes
    app.get("/api/status", (req, res) => {
        res.json({
            connectionStatus,
            qrCode,
            pairingCode,
            botInfo: {
                ...botInfo,
                runtime: formatRuntime(Date.now() - botInfo.runtime)
            },
            settings
        });
    });

    app.post("/api/pair", async (req, res) => {
        const { phoneNumber } = req.body;
        if (!phoneNumber) return res.status(400).json({ error: "Phone number required" });
        
        // Restart bot with pairing code request
        if (socket) {
            try {
                socket.end();
            } catch (e) {}
        }
        startWhatsApp(phoneNumber.replace(/[^0-9]/g, ''));
        res.json({ status: "Pairing requested" });
    });

    app.post("/api/logout", async (req, res) => {
        if (socket) {
            try {
                await socket.logout();
                socket.end();
            } catch (e) {}
        }
        
        // Clear auth folder
        const authPath = path.join(__dirname, 'auth_info_baileys');
        if (fs.existsSync(authPath)) {
            fs.rmSync(authPath, { recursive: true, force: true });
        }
        
        qrCode = null;
        pairingCode = null;
        connectionStatus = "close";
        botInfo.status = "Offline";
        
        startWhatsApp();
        res.json({ status: "Logged out and session cleared" });
    });

    // Direct Pairing Route (Better Solution for 403/Access issues)
    app.get("/pair/:number", async (req, res) => {
        const phoneNumber = req.params.number.replace(/[^0-9]/g, '');
        const shouldReset = req.query.reset === 'true';

        if (!phoneNumber || phoneNumber.length < 10) return res.status(400).send("Invalid phone number. Must be at least 10 digits.");
        
        if (shouldReset) {
            if (socket) {
                try { await socket.logout(); socket.end(); } catch (e) {}
            }
            const authPath = path.join(__dirname, 'auth_info_baileys');
            if (fs.existsSync(authPath)) {
                fs.rmSync(authPath, { recursive: true, force: true });
            }
            pairingCode = null;
            qrCode = null;
            connectionStatus = "close";
        }

        // If already connecting with this number, don't restart
        // (This prevents multiple restarts on page refresh)
        const isAlreadyPairing = pairingCode && pairingCode !== "ERROR_RETRY" && !shouldReset;
        
        if (!isAlreadyPairing) {
            if (socket) {
                try { socket.end(); } catch (e) {}
            }
            startWhatsApp(phoneNumber);
        }

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>CYBER NEXUS - PAIRING</title>
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <style>
                    body { background: #000; color: #0f0; font-family: 'Courier New', Courier, monospace; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; overflow: hidden; }
                    .card { background: rgba(0, 20, 0, 0.9); padding: 3rem; border-radius: 0.5rem; border: 2px solid #0f0; text-align: center; max-width: 90%; box-shadow: 0 0 30px #0f0; position: relative; }
                    .card::before { content: "ACCESSING CYBER NEXUS..."; position: absolute; top: -1.5rem; left: 1rem; background: #000; padding: 0 0.5rem; font-size: 0.8rem; }
                    .code { font-size: 4rem; color: #0f0; letter-spacing: 0.3em; margin: 2rem 0; font-weight: bold; text-shadow: 0 0 15px #0f0; }
                    .status { color: #0a0; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.1em; }
                    .loading { animation: glitch 0.5s infinite; }
                    @keyframes glitch { 0% { opacity: 1; transform: skew(0deg); } 20% { opacity: 0.8; transform: skew(2deg); } 40% { opacity: 1; transform: skew(-2deg); } 60% { opacity: 0.9; transform: skew(1deg); } 80% { opacity: 1; transform: skew(-1deg); } 100% { opacity: 1; transform: skew(0deg); } }
                    .btn { margin-top: 2.5rem; color: #0f0; text-decoration: none; font-size: 0.9rem; border: 1px solid #0f0; padding: 0.7rem 1.5rem; border-radius: 0.2rem; display: inline-block; transition: all 0.3s; text-transform: uppercase; }
                    .btn:hover { background: #0f0; color: #000; box-shadow: 0 0 20px #0f0; }
                    .matrix { position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: -1; opacity: 0.1; pointer-events: none; }
                </style>
            </head>
            <body>
                <div class="matrix" id="matrix"></div>
                <div class="card">
                    <div id="title" style="font-size: 1.5rem; margin-bottom: 0.5rem;">[ SYSTEM_PAIRING ]</div>
                    <div style="color: #0a0; margin-bottom: 2rem; font-size: 0.8rem;">TARGET: +${phoneNumber}</div>
                    <div id="code" class="code loading" onclick="copyCode()" style="cursor: pointer;">_ _ _ _</div>
                    <div id="status" class="status">INITIALIZING_CONNECTION...</div>
                    <div style="margin-top: 1rem; font-size: 0.7rem; color: #050;">(CLICK CODE TO COPY)</div>
                    <div style="margin-top: 2rem; display: flex; gap: 1rem; justify-content: center;">
                        <a href="/" class="btn">> CORE</a>
                        <a href="?reset=true" class="btn" style="border-color: #f00; color: #f00;">> RESET</a>
                    </div>
                </div>
                <script>
                    function copyCode() {
                        const code = document.getElementById('code').innerText;
                        if (code && code !== '_ _ _ _' && code !== 'RETRY' && code !== 'QR_MODE') {
                            navigator.clipboard.writeText(code);
                            const status = document.getElementById('status');
                            const oldText = status.innerText;
                            status.innerText = 'COPIED_TO_CLIPBOARD';
                            setTimeout(() => status.innerText = oldText, 2000);
                        }
                    }
                    const matrix = document.getElementById('matrix');
                    const chars = '0123456789ABCDEFHIJKLMNOPQRSTUVWXYZ';
                    for(let i=0; i<100; i++) {
                        const span = document.createElement('span');
                        span.style.position = 'absolute';
                        span.style.left = Math.random() * 100 + '%';
                        span.style.top = Math.random() * 100 + '%';
                        span.style.fontSize = Math.random() * 20 + 10 + 'px';
                        span.innerText = chars[Math.floor(Math.random() * chars.length)];
                        matrix.appendChild(span);
                    }

                    async function poll() {
                        try {
                            const res = await fetch('/api/status');
                            const data = await res.json();
                            
                            if (data.pairingCode) {
                                if (data.pairingCode === "ERROR_RETRY") {
                                    document.getElementById('status').innerText = 'ERROR: REQUEST_FAILED. RETRYING...';
                                    document.getElementById('code').innerText = 'RETRY';
                                } else {
                                    document.getElementById('code').innerText = data.pairingCode;
                                    document.getElementById('code').classList.remove('loading');
                                    document.getElementById('status').innerText = 'PAIRING_CODE_READY: ENTER_IN_WHATSAPP';
                                    document.getElementById('title').innerText = '[ PAIRING_SUCCESS ]';
                                }
                            } else if (data.connectionStatus === 'open') {
                                document.getElementById('code').innerText = 'ACCESS_GRANTED';
                                document.getElementById('status').innerText = 'CYBER_NEXUS_CONNECTED';
                                setTimeout(() => window.location.href = '/', 2000);
                            } else if (data.qrCode) {
                                // If it switched to QR, something went wrong with pairing request
                                document.getElementById('status').innerText = 'SWITCHED_TO_QR: REFRESH_PAGE_TO_RETRY_PAIRING';
                                document.getElementById('code').innerText = 'QR_MODE';
                            }
                        } catch (e) {}
                        setTimeout(poll, 2000);
                    }
                    poll();
                </script>
            </body>
            </html>
        `);
    });

    // Vite middleware for development
    if (process.env.NODE_ENV !== "production") {
        const vite = await createViteServer({
            server: { middlewareMode: true },
            appType: "spa",
        });
        app.use(vite.middlewares);
    } else {
        app.use(express.static(path.join(__dirname, "dist")));
        app.get("*", (req, res) => {
            res.sendFile(path.join(__dirname, "dist", "index.html"));
        });
    }

    // Keep-alive mechanism to prevent sleeping
    setInterval(() => {
        const appUrl = process.env.APP_URL;
        if (appUrl) {
            fetch(`${appUrl}/health`).catch(() => {});
        }
    }, 300000); // Every 5 minutes

    app.listen(PORT, "0.0.0.0", () => {
        console.log(`Server running on http://0.0.0.0:${PORT}`);
    });

    startWhatsApp();
}

startServer();
