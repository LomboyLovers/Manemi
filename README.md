# MANEMI

## Local Installation and Setup Guide

This guide explains how to download, install, configure, and run the Manemi application on another computer for testing, development, or professor evaluation.

The application can be installed directly from this repository without requiring a separate `my-next-app` folder.

### 1. Requirements

Before proceeding, install the following software:

- **Node.js (LTS):** https://nodejs.org/
- **Git:** https://git-scm.com/
- **Visual Studio Code (recommended):** https://code.visualstudio.com/

An internet connection is required to access the Supabase backend.

### 2. Clone the Repository

Open PowerShell or the VS Code terminal.

Run:

```bash
git clone https://github.com/LomboyLovers/Manemi.git
```

Navigate to the repository:

```bash
cd Manemi
```

Switch to the branch containing the latest frontend:

```bash
git switch working
```

### 3. Open the Project

Open the Manemi repository directly in Visual Studio Code:

```bash
code .
```

Make sure you are inside the directory containing `package.json`.

The project structure should look similar to this:

```text
Manemi/
│
├── app/
├── components/
├── public/
├── lib/
├── package.json
├── package-lock.json
├── next.config.ts
├── tsconfig.json
├── .gitignore
└── README.md
```

Note: The actual folders and files may vary depending on the current project structure.

### 4. Configure Supabase

In the root directory of the Manemi repository, create a file named:

`.env.local`

Add the following environment variables:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
```

Replace the placeholders with the actual Supabase credentials provided by the project developers.

**Important:**
- Do not use the Supabase service role key.
- Do not upload `.env.local` to GitHub.
- Make sure `.env.local` is located in the same directory as `package.json`.

### 5. Install Dependencies

Before running the application, make sure the project's startup scripts and dependencies have been reviewed and verified by the project maintainers.

Once verified, install the dependencies:

```bash
npm install
```

Wait until the installation is complete.

### 6. Start the Application

Run the development server:

```bash
npm run dev
```

Wait for the terminal to display the local server address.

Open your web browser and visit:

http://localhost:3000

The Manemi application should now be accessible.

### 7. Test the Application

The following features can be tested:

1. **Register:** Create a new user account.
2. **Login:** Sign in using registered credentials.
3. **Dashboard:** Access the main dashboard.
4. **Create Group:** Create a new group and save it to Supabase.
5. **View Groups:** Display groups retrieved from Supabase.
6. **Logout:** Sign out of the application.
7. **Route Protection:** Verify that protected pages require authentication.

Some features may still be under development.

### 8. Stop the Application

To stop the development server, return to the terminal and press:

`Ctrl + C`

### 9. Troubleshooting

**`npm` is not recognized**

Install Node.js and restart your terminal.

**`package.json` not found**

Make sure your terminal is inside the root directory of the Manemi repository.

**`Module not found`**

Run the following command to install the required dependencies:

```bash
npm install
```

**Supabase connection error**

Check the values inside `.env.local`. Make sure the Supabase URL and publishable key are correct. Restart the development server after changing environment variables.

**Port 3000 already in use**

Stop the application currently using port 3000 or use the alternative port displayed in the terminal.

**Cannot access the repository**

Ask the project owner to grant you GitHub access if the repository is private.

**Application files are missing**

Make sure the latest frontend branch has been cloned:

```bash
git switch working
git pull origin working
```

If the application files are not present in the repository, contact the project developers to ensure the frontend source code has been committed and pushed to GitHub.

---

## Project Information

- **Project Name:** Manemi
- **Repository:** https://github.com/LomboyLovers/Manemi
- **Branch:** `working`
- **Project Directory:** `Manemi` (root directory)
- **Framework:** Next.js
- **Frontend:** React and TypeScript
- **Backend:** Supabase
- **Package Manager:** npm

---

*Manemi — Local Setup Instructions for Testing and Evaluation*