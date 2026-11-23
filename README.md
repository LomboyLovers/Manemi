# SplitEase 

SplitEase is a smart web application designed to eliminate financial friction among roommates, travel groups, and event organizers. It simplifies shared expense logging, tracks running group balances, and uses a settlement algorithm to reduce the total number of payments required to clear all group debts.
# Core Functionality & Features

# Authentication & Group Management
User account creation with secure login and session management.
Create private groups (e.g., "Apartment 4B", "Japan Trip 2026") and generate shareable invite links or room codes.

# Flexible Expense Logging
Log shared expenses with custom titles, dates, categories (Groceries, Utilities, Rent, Entertainment), and receipt photo uploads.
Support for multiple splitting methods:
Equal Split: Divide total evenly among all selected group members.
Exact Amount / Unequal Split: Specify exact dollar amounts per person.
Percentage Split: Split by customized percentages (with automated validation to ensure the total reaches 100%).

# Smart Settlement & Debt Minimization
Automated Debt Simplification: An algorithm continuously analyzes all group expenses and computes the minimal set of transactions needed to settle up (e.g., turning 5 complex debts across 4 people into 2 direct payments).
Balance Summary Dashboard: Clear personal view showing "You are owed $X" or "You owe $Y overall" within each group.

# Settlement Tracking
Record cash or external payments (e.g., Venmo/PayPal transfers) to log off individual debts and update group balances in real time.
Complete transaction history showing every logged bill, edits, and recorded settlements.

# Reporting & Exporting
Visual breakdown of group expenses by category using simple charts.


---

# Running Manemi on Your Own Computer (VS Code)

The sections above describe what the app does (they use an earlier project name). The app is now called **Manemi**. Everything below explains how to download it and run it on a computer that is not the developer's, using Visual Studio Code. Allow about 10 minutes.

## 1. What you need

| Tool | Why | Download |
| --- | --- | --- |
| **Node.js 20.9 or newer** (the LTS version is fine) | Runs the app and installs its packages | https://nodejs.org/ |
| **Git** | Downloads the code | https://git-scm.com/ |
| **Visual Studio Code** | Where you open the project and run commands | https://code.visualstudio.com/ |

You also need an internet connection, because the app's data and sign-in live in Supabase.

Check that everything installed by opening a terminal and running:

```bash
node -v
npm -v
git --version
```

Each command should print a version number. If one says "not recognized", install that tool and **restart VS Code** (or the terminal).

## 2. Download the code

Open any terminal (PowerShell, Terminal, or the one inside VS Code) in the folder where you keep your projects, then run:

```bash
git clone https://github.com/LomboyLovers/Manemi.git
cd Manemi
```

The default branch (`main`) has the latest version, so you do not need to switch branches. To get future updates later, run `git pull` inside the folder.

## 3. Open it in VS Code

From inside the `Manemi` folder run:

```bash
code .
```

or in VS Code choose **File → Open Folder…** and select the `Manemi` folder. It must be the folder that directly contains `package.json`.

Open the built-in terminal with **View → Terminal** (shortcut: `` Ctrl+` ``). Every command below is typed in this terminal.

**Quick safety check before installing.** This project had a malware incident in the past that has since been cleaned. Before you run `npm install`, confirm that the `scripts` section of `package.json` contains only these four lines, and that the root folder has no file called `init` or `config.bat`:

```json
"dev": "next dev",
"build": "next build",
"start": "next start",
"lint": "eslint"
```

If anything else is there, stop and tell the project owner.

## 4. Add the Supabase settings

The app needs two values to find its database. They are kept out of GitHub on purpose.

1. In the root folder (next to `package.json`) create a file named exactly **`.env.local`**.
   - Easiest way: copy the template. In PowerShell run `Copy-Item .env.example .env.local` (on macOS/Linux: `cp .env.example .env.local`).
2. Fill it in like this:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
```

Get both values from the project owner. If you have access to the Supabase project, they are under **Project Settings → API**.

**Important**

- Use the **anon / publishable** key only. Never use the `service_role` key.
- Never upload `.env.local` to GitHub. It is already ignored by Git.
- If you change `.env.local` while the app is running, stop the app and start it again.

## 5. Install the packages

```bash
npm install
```

Wait until it finishes. This can take a couple of minutes the first time.

## 6. Start the app

```bash
npm run dev
```

When the terminal says `Ready`, open **http://localhost:3000** in your browser.

## 7. Try it out

1. **Register** a new account. Supabase sends a confirmation email, so use an inbox you can open. A "Check your email" pop-up appears; click the link in the email, then go back to **Login**.
2. **Log in** and look around the Dashboard.
3. **Create a group**, add a member, and **add an expense** (equal, exact-amount or percentage split).
4. **Settle up** a balance, then check **History** and **Reports** (you can export a CSV or PDF).
5. Tap the **bell** to see notifications, and open your **account** (top-left) to edit your profile.

If the link in the confirmation email does not open, ask the project owner to check the Supabase **Site URL** setting. Open the link on the same computer that is running the app.

## 8. Open it on your phone (optional)

Your phone and computer must be on the **same Wi-Fi**.

1. On the computer, find its IPv4 address: run `ipconfig` in PowerShell (look under *Wi-Fi*) or `ifconfig` / `ip addr` on macOS and Linux. It looks like `192.168.1.23`.
2. On the phone, open `http://THAT-ADDRESS:3000` (for example `http://192.168.1.23:3000`).

If the phone cannot connect:

```bash
npm run dev -- -H 0.0.0.0
```

and, on Windows, allow Node.js through the firewall on **Private** networks when the pop-up asks. Over plain `http://` on a phone, the browser may show a harmless "WebCrypto" notice in the terminal. That is normal during local testing.

## 9. Stop the app

Click in the terminal and press `Ctrl + C`.

## 10. Troubleshooting

| Problem | What to do |
| --- | --- |
| `npm` is not recognized | Install Node.js, then fully close and reopen VS Code. |
| PowerShell says "running scripts is disabled on this system" | Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, or use **Command Prompt** instead of PowerShell. |
| `package.json` not found | Your terminal is in the wrong folder. Run `cd Manemi` (the folder with `package.json`). |
| `Module not found` | Run `npm install` again. |
| Port 3000 is already in use | Close the other program, or use the other address the terminal prints (for example `3001`). |
| Blank data, sign-in fails, or a Supabase error | Check `.env.local`: the file name, its location next to `package.json`, and that both values are correct with no extra spaces or quotes. Restart the app after fixing it. |
| A red "1 Issue" badge about hydration appears | A browser feature or extension added attributes to the page. It only appears while developing and does no harm. Click the X to dismiss it. |
| Cannot download the repository | Check you typed the address exactly as above and that you are online. |
| Application files are missing | Run `git pull` and make sure you are on the `main` branch: `git switch main`. |

## Project information

- **Project name:** Manemi
- **Repository:** https://github.com/LomboyLovers/Manemi
- **Branch:** `main`
- **Framework:** Next.js with React and TypeScript
- **Backend:** Supabase (database, sign-in, live updates and email functions)
- **Package manager:** npm

*Manemi: setup guide for running the project on another computer.*
