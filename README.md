# FitLog — IT340 System Administration

A web-based fitness logging application built for the IT340 System Administration course. The app handles user registration and login, and is designed to run across 3 application instances and 1 router instance connected through a VLAN.

---

## Directory Structure

```
IT340-FitLog/
├── app.py                  # Flask application — all routes, DB logic, session handling
├── requirements.txt        # Python dependencies
├── docker-compose.yml      # Local dev environment (MongoDB + app container)
├── Dockerfile              # Container definition for the app
├── README.md
├── .gitignore
├── static/
│   ├── css/
│   │   └── style.css       # Styles for login, register, and dashboard views
│   └── js/
│       └── main.js         # Frontend logic — API calls, view switching, form validation
└── templates/
    └── index.html          # Single-page app — all three views in one HTML file
```

---

## Tech Stack

**Python 3 / Flask** — serves the app, handles all routes and session management

**MongoDB** — stores user accounts in the `fitlog` database, `users` collection. A unique index on `email` prevents duplicate accounts. MongoDB runs on one dedicated instance and is accessed by all app instances over the VLAN.

**pymongo** — official Python driver for MongoDB

**Werkzeug** — password hashing (included with Flask); passwords are never stored in plaintext

**HTML / CSS / JavaScript** — `index.html` renders all three views (login, register, dashboard); `style.css` styles them; `main.js` handles view switching, form validation, and all AJAX API calls

---

## API Routes

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/` | Serves the single-page frontend |
| POST | `/api/register` | Creates a new user account |
| POST | `/api/login` | Authenticates a user and starts a session |
| POST | `/api/logout` | Clears the session |
| GET | `/api/me` | Returns the currently logged-in user |

---

## How It Works

1. The Flask app starts, connects to MongoDB, and creates a unique index on `email` if it doesn't exist.
2. A user registers via the frontend — the app validates input, hashes the password with Werkzeug, and inserts a document into MongoDB's `users` collection.
3. On login, the app does a `find_one` lookup by email and verifies the password hash.
4. Sessions are stored server-side in Flask's signed cookie session (not in the database).
5. Security headers (`X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`) are added to every response.

---

## VLAN Network Setup (4-Instance Deployment)

### Instance Roles

| Instance | Role | Runs |
|----------|------|------|
| Instance 1 | Router | Connects all instances over the VLAN — no app software needed |
| Instance 2 | App Server | Flask app (`app.py`) |
| Instance 3 | App Server | Flask app (`app.py`) |
| Instance 4 | App Server + DB | Flask app (`app.py`) + MongoDB |

> MongoDB runs only on Instance 4. All three app instances connect to it over the VLAN.

### Step-by-Step Setup

#### On all app instances (2, 3, and 4)

1. Install Python 3 and pip:
   ```bash
   sudo apt update && sudo apt install -y python3 python3-pip
   ```

2. Clone or copy the project files onto the instance.

3. Install Python dependencies:
   ```bash
   pip3 install -r requirements.txt
   ```

#### On Instance 4 (MongoDB host) — additional steps

4. Install MongoDB:
   ```bash
   sudo apt install -y gnupg curl
   curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
   echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
   sudo apt update && sudo apt install -y mongodb-org
   ```

5. Configure MongoDB to accept connections from the VLAN (not just localhost). Edit `/etc/mongod.conf`:
   ```yaml
   net:
     bindIp: 0.0.0.0   # listens on all interfaces including the VLAN interface
     port: 27017
   ```

6. Start and enable MongoDB:
   ```bash
   sudo systemctl start mongod
   sudo systemctl enable mongod
   ```

#### Starting the app on each instance (2, 3, and 4)

For **Instance 4** (where MongoDB is running locally):
```bash
MONGO_HOST=localhost python3 app.py
```

For **Instances 2 and 3** (connecting to Instance 4 over the VLAN — replace the IP with Instance 4's actual VLAN IP):
```bash
MONGO_HOST=<instance-4-vlan-ip> python3 app.py
```

The app will be available at `http://<instance-ip>:5000` on each machine.

---

## What the MongoDB Instance Owner Needs to Change

The only value that needs to change per-instance is `MONGO_HOST`. It is read from an environment variable — **no code edits are needed**.

However, the person running MongoDB on Instance 4 must:

1. **Open port 27017 in the firewall** so the other instances can reach MongoDB:
   ```bash
   sudo ufw allow from <vlan-subnet>/24 to any port 27017
   sudo ufw enable
   ```
   Replace `<vlan-subnet>` with your actual VLAN subnet (e.g., `192.168.10.0`).

2. **Confirm MongoDB is listening on the VLAN interface** (after editing `bindIp` above):
   ```bash
   sudo systemctl restart mongod
   # verify it's listening on 0.0.0.0 or the VLAN IP:
   ss -tlnp | grep 27017
   ```

3. **Share the VLAN IP** of Instance 4 with the other group members so they can set `MONGO_HOST` correctly.

Once those three things are done, all instances will share the same MongoDB database over the VLAN.

---

## Local Development (Docker)

To test the full stack locally on a single machine:

```bash
docker-compose up --build
```

Open: `http://localhost:5000`

This starts a MongoDB container and the Flask app container, wired together automatically — no VLAN or manual MongoDB install needed for local testing.

To stop:
```bash
docker-compose down
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MONGO_HOST` | `localhost` | IP or hostname of the MongoDB instance |
| `MONGO_PORT` | `27017` | MongoDB port |
| `MONGO_DB` | `fitlog` | MongoDB database name |
| `SECRET_KEY` | `fitlog-dev-secret-key` | Flask session signing key — change this in production |
