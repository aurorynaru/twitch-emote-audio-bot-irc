# Twitch Interactive Overlay
**Emote and Audio Overlay powered by Custom Chat Commands and an Internal Economy.**

This overlay listens to your Twitch chat for custom commands (like `!showemote` and `!playsound`) and uses an internal points economy to trigger emotes and play sounds.

## Installation

You can either run this overlay locally on your computer or host it in the cloud using Railway.

### Option 1: Local Installation (Recommended for beginners)

**Prerequisites:**
1. **OBS Studio** (or any streaming software that supports Browser Sources).
2. **Node.js** (Required to run the local server).

#### Windows
1. Go to the [Node.js Official Website](https://nodejs.org/).
2. Download the **LTS (Long Term Support)** installer for Windows.
3. Run the installer. **CRITICAL:** During the installation process, make sure the **"Add to PATH"** checkbox is selected!
4. Finish the installation.

#### macOS
1. Go to the [Node.js Official Website](https://nodejs.org/).
2. Download the **LTS** installer for macOS (`.pkg` file).
3. Run the installer and follow the standard installation prompts.
*(Alternatively, if you use Homebrew, you can open your terminal and run `brew install node`)*

#### Linux
For most Debian/Ubuntu-based Linux distributions, open your terminal and run the following commands:
```bash
sudo apt update
sudo apt install nodejs npm
```
*(For other distributions, refer to your package manager's Node.js installation instructions).*

### Option 2: Railway Installation (Cloud Hosting)

Hosting on Railway means your server runs 24/7 in the cloud and you don't need to keep a `.bat` file open on your PC while streaming.

1. Create a free account on [Railway](https://railway.app/).
2. Click **New Project** -> **Deploy from GitHub repo**.
3. Select this repository from your GitHub account.
4. Add a Database Volume:
   - To keep your Twitch login valid when Railway restarts, click your service in Railway, go to the **Volumes** tab, and add a new volume mapped to `/app/data`.
5. Set Environment Variables:
   - Go to the **Variables** tab in Railway.
   - You will add your Twitch credentials here instead of in the `.env` file (see Setup Guide below for how to get these keys).
   - Add these exact variable names and their values: `CLIENT_ID`, `CLIENT_SECRET`, `AUTH_CODE`, `TARGET_CHANNEL`, `EMOTE_DURATION_MS`, `EMOTE_SIZE_PX`, `ADMIN_USER`, `ADMIN_PASSWORD`.
   - **Note:** `ADMIN_USER` and `ADMIN_PASSWORD` are required to securely access the `/addsound` and `/export-database` routes.
   - **Note:** For Railway, when creating the Twitch App (Step 1 below), your **OAuth Redirect URL** must be set to `http://localhost`. Generate your `AUTH_CODE` locally first using the Setup Guide, and paste it into Railway.

---

## Setup Guide

To connect this overlay to Twitch, you need to generate three secret keys. Follow these steps exactly:

### Step 1: Get your Client ID and Client Secret
1. Go to the [Twitch Developer Console](https://dev.twitch.tv/console) and log in.
2. Click **"Register Your Application"**.
3. Fill out the form:
   - **Name:** Emote Overlay (or any name you want)
   - **OAuth Redirect URLs:** `http://localhost` *(This must be exactly this!)*
   - **Category:** Website Integration
4. Click **Create**.
5. Click **Manage** next to your new app.
6. Copy your **Client ID** and paste it into your `.env` file.
7. Click **New Secret**, copy the **Client Secret**, and paste it into your `.env` file.

### Step 2: Get your Auth Code
Twitch needs your explicit permission to read chat messages.

1. Copy the following link, but **replace `YOUR_CLIENT_ID`** with the actual Client ID you got in Step 1:
   ```text
   https://id.twitch.tv/oauth2/authorize?response_type=code&client_id=YOUR_CLIENT_ID&redirect_uri=http://localhost&scope=chat:read+chat:edit+bits:read+channel:read:subscriptions+channel:read:redemptions
   ```
2. Paste that modified link into your browser and hit Enter.
3. Click **Authorize** on the Twitch page.
4. You will be redirected to a page that looks broken or says "This site can’t be reached". **This is normal!**
5. Look at the URL bar at the top of your browser. It will look something like this:
   `http://localhost/?code=123456abcd&scope=user%3Aread%3Achat`
6. Copy the text directly after `code=` and before `&scope`. In the example above, the code is `123456abcd`.
7. Paste this code into your `.env` file as `AUTH_CODE`.

*(Note: Auth Codes can only be used ONCE. If you ever delete your `tokens.json` file, you will need to repeat Step 2 to get a new code!)*

### Step 3: Configure Environment Variables

Open your `.env` file and set the following variables:

- `TARGET_CHANNEL`: Your Twitch username.
- `EMOTE_DURATION_MS`: How long the emote stays on screen (in milliseconds).
- `EMOTE_SIZE_PX`: How big the emotes are on screen.
- `PORT`: 7777 (default).
- `ADMIN_USER`: A username of your choice for the admin panel.
- `ADMIN_PASSWORD`: A password of your choice for the admin panel.
- `CLIENT_ID`: Your Twitch Client ID.
- `CLIENT_SECRET`: Your Twitch Client Secret.
- `AUTH_CODE`: Your Twitch Auth Code.

### Step 4: Run the App

**If running Locally:**
1. Double-click the **`start_overlay.bat`** file in the project folder. It will automatically install any missing dependencies and start the server.
2. Open OBS Studio.
3. Add a new **Browser Source**.
4. Set the URL to: `http://localhost:7777/overlay`
5. Set your resolution width and height
6. Click OK

**If running on Railway:**
1. Ensure your Railway project has successfully deployed.
2. Open OBS Studio.
3. Add a new **Browser Source**.
4. Set the URL to your Railway app's public domain (e.g., `https://your-app-name.up.railway.app/overlay`). You can generate a domain in Railway under the **Settings** -> **Networking** tab.
5. Set your resolution width and height
6. Click OK

### Adding Playsounds
You can add custom sound effect (`.ogg` or `.mp3` format) in two different ways:

**Manual Method:**
Copy the audio file directly into the `playsounds` folder inside the project directory.

**Web Upload Method:**
1. Make sure your `start.bat` server is running.
2. Open your web browser and go to `http://localhost:7777/addsound`.
3. Click "Choose File", select your `.ogg` or `.mp3` file, and click upload!

### How to use Playsounds
Viewers can trigger sounds in your chat using the `!playsound` command followed by the exact filename of the audio file.
For example, if you uploaded a file named `bonk.mp3`, the viewer just needs to type `!playsound bonk` in chat.

### Optional: Volume Limiting
To prevent extremely loud sound effects from blowing out your viewers' ears, you can easily limit the volume directly in OBS:
1. In OBS, right-click your Emote Overlay Browser Source in the Audio Mixer and select **Filters**.
2. Click the `+` icon and add a **Compressor**.
3. Click the `+` icon again and add a **Limiter**.



