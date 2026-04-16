# FitLog


## Directory Structure

```
IT342-FitLog/
├── app.py                  
├── requirements.txt        
├── README.md
├── .gitignore
├── static/
│   ├── css/
│   │   └── style.css       
│   └── js/
│       └── main.js         
└── templates/
    └── index.html           
```

---

## API Routes


| GET | `/` 
| POST | `/api/register` 
| POST | `/api/login` 
| POST | `/api/logout` 
| GET | `/api/me` 

---

## Tech Stack

**Python / Flask** — serves the app, handles all routes and session management

**AWS DynamoDB** — stores users in table `fitlog-users` (partition key: `email`), `PAY_PER_REQUEST` billing, auto-created on first run

**boto3** — Python SDK for DynamoDB; uses IAM instance profile automatically on EC2

**Werkzeug** — password hashing, included with Flask

**HTML / CSS / JavaScript** — `index.html` renders all three views; `style.css` styles them; `main.js` handles view switching, form validation, and all API calls

---

## Docker 


```
Run docker to test application locally before we actually deploy
docker-compose up --build
```

Open: `http://localhost:5000`

To stop: `docker-compose down`



