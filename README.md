# WhatsApp Bot

A powerful, feature-rich WhatsApp bot built with Node.js and the Baileys library. This bot is designed to be easily deployable on platforms like Railway or any VPS, and includes a wide variety of automation and group management features.

## Features

### ⚙️ Automatic Behaviors (Global Settings)
Control the bot's automatic behaviors directly via WhatsApp commands (requires owner privileges):
- `.autoread [on/off]` - Automatically marks incoming messages as read.
- `.autotyping [on/off]` - Shows "typing..." when a message is received.
- `.autorecording [on/off]` - Shows "recording audio..." when a message is received.
- `.autoreact [on/off]` - Reacts to incoming messages with a random emoji.
- `.autoapprove [on/off]` - Automatically approves pending group join requests.
- `.alwaysonline [on/off]` - Keeps the bot's presence as "Available".
- `.autoviewstatus [on/off]` - Automatically marks status updates as read.

### 👥 Group Management (Admins & Owner)
Manage your groups efficiently with these commands:
- `.promote [@mention/reply]` - Promotes a member to admin.
- `.demote [@mention/reply]` - Demotes an admin.
- `.kick [@mention/reply]` - Removes a user from the group.
- `.add [number]` - Adds a user via their phone number.
- `.mute` / `.closegroup` - Restricts messaging to admins only.
- `.unmute` / `.opengroup` - Allows everyone to send messages.
- `.linkgc` - Generates and sends the group invite link.
- `.leave` - Makes the bot leave the group.
- `.hidetag [message]` - Tags everyone invisibly.
- `.tagall [message]` - Explicitly tags every member in a list.

### 🛡️ Group Settings & Protection (Admins & Owner)
Keep your groups safe from spam and unwanted content:
- `.antilink [on/off]` - Deletes messages with links and warns the sender.
- `.antispam [on/off]` - Tracks messages per user to prevent spamming (kicks/warns if >5 messages in 10s).
- `.antimention [on/off]` - Deletes messages that mention other users.
- `.antitag [on/off]` - Deletes messages that attempt to use "tag all" or "hidetag" features.
- `.welcome [on/off]` - Sends a welcome message when a new user joins.
- `.goodbye [on/off]` - Sends a goodbye message when a user leaves.

## Deployment

### Prerequisites
- Node.js (v18 or higher)
- A WhatsApp account to link the bot to

### Local Setup
1. Clone the repository:
   ```bash
   git clone <your-repo-url>
   cd whatsapp-bot
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the bot:
   ```bash
   npm start
   ```
4. Scan the QR code printed in the terminal with your WhatsApp app (Linked Devices).

### Deploying to Railway
1. Fork this repository to your GitHub account.
2. Create a new project on [Railway](https://railway.app/).
3. Connect your GitHub repository.
4. Railway will automatically detect the `Dockerfile` and `package.json` and deploy the bot.
5. Check the deploy logs to scan the QR code and link your WhatsApp account.

## Configuration
The bot saves all its settings in a local `settings.json` file. This ensures that your preferences (like `.autoread on` or group-specific `.antilink on`) persist across restarts.

## License
MIT License
