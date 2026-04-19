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


