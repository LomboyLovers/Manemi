<<<<<<< HEAD
This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).
=======

# MANEMI

## Local Installation and Setup Guide

This guide provides step-by-step instructions for running the Manemi application on another computer for testing, development, or professor evaluation.

### 1. Requirements

Before proceeding, install the following software:

- **Node.js (LTS):** https://nodejs.org/
- **Git:** https://git-scm.com/
- **Visual Studio Code (recommended):** https://code.visualstudio.com/

An internet connection is required to access the Supabase backend.

### 2. Clone the Repository

> > > > > > > tatorrubia

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
git switch tatorrubia
```

### 3. Open the Application Folder

Navigate to the Next.js project:

```bash
cd my-next-app
```

Open it in Visual Studio Code:

```bash
code .
```

### 4. Configure Supabase

Inside the `my-next-app` folder, create a file named:

`.env.local`

Add the following:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
```

Replace the placeholders with the actual Supabase credentials provided by the project developers.

**Note:** Do not use the Supabase service role key. Do not upload `.env.local` to GitHub.

### 5. Install Dependencies

**Security prerequisite:** The project maintainers must first inspect and remove or verify the repository's `init` startup script and VS Code automatic tasks. Do not run unverified project scripts.

After the repository has been cleared, run:

```bash
npm install
```

Wait until the installation is complete.

### 6. Start the Application

After verifying that the project startup scripts are safe, run:

```bash
npm run dev
```

Wait for the terminal to display the local server address.

Open a web browser and visit:

http://localhost:3000

The Manemi login page should appear.

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

Install Node.js and restart the terminal.

**`Module not found`**

Ensure dependencies were installed and the terminal is inside `my-next-app`.

**Supabase connection error**

Verify the values in `.env.local` and restart the development server.

**Port 3000 already in use**

Stop the application currently using port 3000 or use the alternative port shown in the terminal.

**Cannot access the repository**

Ask the project owner to grant GitHub access if the repository is private.

---

**Repository:** https://github.com/LomboyLovers/Manemi

**Branch:** `tatorrubia`

**Project Directory:** `my-next-app`

**Framework:** Next.js, React, TypeScript

**Backend:** Supabase

---

_Manemi — Local Setup Instructions for Testing and Evaluation_
