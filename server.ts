import express from 'express';
import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import fs from 'fs';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Basic health check endpoint for Railway/VPS
app.get('/', (req, res) => {
    res.send('WhatsApp Bot is running!');
});

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

const SETTINGS_FILE = './settings.json';

let settings = {
    autoread: false,
    autotyping: false,
    autorecording: false,
    autoreact: false,
    autoapprove: false,
    alwaysonline: false,
    autoviewstatus: false,
    groups: {} as Record<string, any>
};

if (fs.existsSync(SETTINGS_FILE)) {
    settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
}

function saveSettings() {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

function getGroupSettings(jid: string) {
    if (!settings.groups[jid]) {
        settings.groups[jid] = {
            antilink: false,
            antispam: false,
            antimention: false,
            antitag: false,
            welcome: false,
            goodbye: false
        };
    }
    return settings.groups[jid];
}

const spamTracker: Record<string, number[]> = {};

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }) as any
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed due to ', lastDisconnect?.error, ', reconnecting ', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            } else {
                console.log('Logged out. Please delete the auth_info_baileys folder and restart to scan a new QR code.');
            }
        } else if (connection === 'open') {
            console.log('Opened connection to WhatsApp');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Always Online
    setInterval(() => {
        if (settings.alwaysonline) {
            sock.sendPresenceUpdate('available').catch(() => {});
        }
    }, 10000);

    // Auto Approve Join Requests
    sock.ev.on('group.join-request', async (data) => {
        if (settings.autoapprove) {
            try {
                await sock.groupRequestParticipantsUpdate(data.id, [data.participant], 'approve');
                console.log(`Auto-approved ${data.participant} in ${data.id}`);
            } catch (err) {
                console.error('Failed to auto-approve:', err);
            }
        }
    });

    // Welcome / Goodbye
    sock.ev.on('group-participants.update', async (update) => {
        const { id, participants, action } = update;
        const groupSet = getGroupSettings(id);

        if (action === 'add' && groupSet.welcome) {
            for (const p of participants) {
                await sock.sendMessage(id, { text: `Welcome to the group, @${p.split('@')[0]}!`, mentions: [p] });
            }
        } else if (action === 'remove' && groupSet.goodbye) {
            for (const p of participants) {
                await sock.sendMessage(id, { text: `Goodbye, @${p.split('@')[0]}!`, mentions: [p] });
            }
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;

        for (const msg of m.messages) {
            if (!msg.message) continue;

            const jid = msg.key.remoteJid!;
            const isGroup = jid.endsWith('@g.us');
            const sender = msg.key.participant || jid;
            const fromMe = msg.key.fromMe;

            // Auto View Status
            if (jid === 'status@broadcast' && !fromMe) {
                if (settings.autoviewstatus) {
                    try {
                        await sock.readMessages([{
                            remoteJid: jid,
                            id: msg.key.id,
                            participant: msg.key.participant
                        }]);
                        console.log(`Viewed status from ${msg.key.participant}`);
                    } catch (err) {
                        console.error('Error viewing status:', err);
                    }
                }
                continue;
            }

            const text = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || msg.message.videoMessage?.caption || '';
            const args = text.trim().split(/ +/);
            const command = args[0].toLowerCase();
            const param = args[1]?.toLowerCase();

            // Auto Read
            if (settings.autoread && !fromMe) {
                await sock.readMessages([msg.key]);
            }

            // Auto Typing / Recording
            if (settings.autotyping && !fromMe) {
                await sock.sendPresenceUpdate('composing', jid);
            } else if (settings.autorecording && !fromMe) {
                await sock.sendPresenceUpdate('recording', jid);
            }

            // Auto React
            if (settings.autoreact && !fromMe) {
                const emojis = ['👍', '❤️', '😂', '😮', '😢', '👏', '🔥', '🎉', '💯'];
                const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
                await sock.sendMessage(jid, { react: { text: randomEmoji, key: msg.key } });
            }

            // Group Protections & Logic
            let isAdmin = false;
            let isBotAdmin = false;
            let groupMetadata = null;

            if (isGroup) {
                try {
                    groupMetadata = await sock.groupMetadata(jid);
                    const admins = groupMetadata.participants.filter(p => p.admin !== null).map(p => p.id);
                    isAdmin = admins.includes(sender);
                    const botId = sock.user?.id.split(':')[0] + '@s.whatsapp.net';
                    isBotAdmin = admins.includes(botId!);

                    const groupSet = getGroupSettings(jid);

                    // Anti-Spam
                    if (groupSet.antispam && !isAdmin && !fromMe) {
                        const now = Date.now();
                        if (!spamTracker[sender]) spamTracker[sender] = [];
                        spamTracker[sender] = spamTracker[sender].filter(t => now - t < 10000);
                        spamTracker[sender].push(now);

                        if (spamTracker[sender].length > 5) {
                            if (isBotAdmin) {
                                await sock.sendMessage(jid, { text: `@${sender.split('@')[0]} has been kicked for spamming.`, mentions: [sender] });
                                await sock.groupParticipantsUpdate(jid, [sender], 'remove');
                            } else {
                                await sock.sendMessage(jid, { text: `Warning: @${sender.split('@')[0]} is spamming!`, mentions: [sender] });
                            }
                            spamTracker[sender] = [];
                        }
                    }

                    // Anti-Link
                    if (groupSet.antilink && !isAdmin && !fromMe) {
                        if (text.includes('http://') || text.includes('https://')) {
                            if (isBotAdmin) {
                                await sock.sendMessage(jid, { delete: msg.key });
                                await sock.sendMessage(jid, { text: `@${sender.split('@')[0]} links are not allowed!`, mentions: [sender] });
                            }
                        }
                    }

                    // Anti-Mention
                    if (groupSet.antimention && !isAdmin && !fromMe) {
                        const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                        if (mentions.length > 0) {
                            if (isBotAdmin) {
                                await sock.sendMessage(jid, { delete: msg.key });
                            }
                        }
                    }

                    // Anti-Tag (hidetag/tagall)
                    if (groupSet.antitag && !isAdmin && !fromMe) {
                        const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                        if (mentions.length > 5 || text.includes('@all')) {
                            if (isBotAdmin) {
                                await sock.sendMessage(jid, { delete: msg.key });
                            }
                        }
                    }
                } catch (err) {
                    console.error('Error processing group logic:', err);
                }
            }

            // Commands
            if (!text.startsWith('.')) continue;

            const isOwner = fromMe || sender === sock.user?.id.split(':')[0] + '@s.whatsapp.net';

            const reply = async (t: string) => {
                await sock.sendMessage(jid, { text: t }, { quoted: msg });
            };

            // Global Settings Commands (Owner only)
            if (isOwner) {
                if (['.autoread', '.autotyping', '.autorecording', '.autoreact', '.autoapprove', '.alwaysonline', '.autoviewstatus'].includes(command)) {
                    if (param === 'on' || param === 'off') {
                        const settingName = command.substring(1);
                        settings[settingName as keyof typeof settings] = (param === 'on') as never;
                        saveSettings();
                        await reply(`${settingName} is now ${param.toUpperCase()}`);
                    } else {
                        await reply(`Usage: ${command} [on/off]`);
                    }
                    continue;
                }
            }

            // Group Management Commands (Admins Only)
            if (isGroup && (isAdmin || isOwner)) {
                const mentionedJid = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                const quotedMsg = msg.message.extendedTextMessage?.contextInfo?.participant;
                const target = mentionedJid[0] || quotedMsg;

                switch (command) {
                    case '.promote':
                        if (!isBotAdmin) { await reply('Bot must be an admin to promote.'); break; }
                        if (!target) { await reply('Mention or reply to a user to promote.'); break; }
                        await sock.groupParticipantsUpdate(jid, [target], 'promote');
                        await reply(`Promoted @${target.split('@')[0]}`);
                        break;
                    case '.demote':
                        if (!isBotAdmin) { await reply('Bot must be an admin to demote.'); break; }
                        if (!target) { await reply('Mention or reply to a user to demote.'); break; }
                        await sock.groupParticipantsUpdate(jid, [target], 'demote');
                        await reply(`Demoted @${target.split('@')[0]}`);
                        break;
                    case '.kick':
                        if (!isBotAdmin) { await reply('Bot must be an admin to kick.'); break; }
                        if (!target) { await reply('Mention or reply to a user to kick.'); break; }
                        await sock.groupParticipantsUpdate(jid, [target], 'remove');
                        await reply(`Kicked @${target.split('@')[0]}`);
                        break;
                    case '.add':
                        if (!isBotAdmin) { await reply('Bot must be an admin to add.'); break; }
                        const number = args[1];
                        if (!number) { await reply('Provide a number to add.'); break; }
                        const addJid = number.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                        await sock.groupParticipantsUpdate(jid, [addJid], 'add');
                        await reply(`Added ${number}`);
                        break;
                    case '.mute':
                    case '.closegroup':
                        if (!isBotAdmin) { await reply('Bot must be an admin.'); break; }
                        await sock.groupSettingUpdate(jid, 'announcement');
                        await reply('Group closed. Only admins can send messages.');
                        break;
                    case '.unmute':
                    case '.opengroup':
                        if (!isBotAdmin) { await reply('Bot must be an admin.'); break; }
                        await sock.groupSettingUpdate(jid, 'not_announcement');
                        await reply('Group opened. Everyone can send messages.');
                        break;
                    case '.linkgc':
                        if (!isBotAdmin) { await reply('Bot must be an admin.'); break; }
                        const code = await sock.groupInviteCode(jid);
                        await reply(`https://chat.whatsapp.com/${code}`);
                        break;
                    case '.leave':
                        await reply('Goodbye!');
                        await sock.groupLeave(jid);
                        break;
                    case '.hidetag':
                        if (!groupMetadata) break;
                        const hidetagMsg = args.slice(1).join(' ');
                        const allMembers = groupMetadata.participants.map(p => p.id);
                        await sock.sendMessage(jid, { text: hidetagMsg, mentions: allMembers });
                        break;
                    case '.tagall':
                        if (!groupMetadata) break;
                        const tagMsg = args.slice(1).join(' ') || 'Tag All';
                        const members = groupMetadata.participants.map(p => p.id);
                        let mentionText = `${tagMsg}\n\n`;
                        for (const mem of members) {
                            mentionText += `* @${mem.split('@')[0]}\n`;
                        }
                        await sock.sendMessage(jid, { text: mentionText, mentions: members });
                        break;
                }

                // Group Settings Commands
                if (['.antilink', '.antispam', '.antimention', '.antitag', '.welcome', '.goodbye'].includes(command)) {
                    if (param === 'on' || param === 'off') {
                        const settingName = command.substring(1);
                        const groupSet = getGroupSettings(jid);
                        groupSet[settingName] = (param === 'on');
                        saveSettings();
                        await reply(`${settingName} is now ${param.toUpperCase()} for this group.`);
                    } else {
                        await reply(`Usage: ${command} [on/off]`);
                    }
                }
            }
        }
    });
}

// Start Express server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
    // Start WhatsApp bot
    connectToWhatsApp().catch(err => console.error('Unexpected error:', err));
});
