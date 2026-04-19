from flask import Flask, request, jsonify, session, render_template
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
from pymongo import MongoClient
from pymongo.errors import DuplicateKeyError
import uuid
import os
import re

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'fitlog-dev-secret-key')

FRONTEND_ORIGIN = os.environ.get('FRONTEND_ORIGIN', '')
CORS(app, origins=FRONTEND_ORIGIN or '*', supports_credentials=True)

app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['PERMANENT_SESSION_LIFETIME'] = 3600  # 1 hour

MONGO_HOST = os.environ.get('MONGO_HOST', 'localhost')
MONGO_PORT = int(os.environ.get('MONGO_PORT', '27017'))
MONGO_DB = os.environ.get('MONGO_DB', 'fitlog')

_client = MongoClient(MONGO_HOST, MONGO_PORT)


def get_db():
    return _client[MONGO_DB]


def get_users():
    return get_db()['users']


def validate_name(name):
    if not name or len(name) > 50:
        return False
    return bool(re.match(r"^[a-zA-Z\s\-']+$", name))


def validate_email(email):
    if not email or len(email) > 254:
        return False
    return bool(re.match(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$', email))


def init_db():
    users = get_users()
    users.create_index('email', unique=True)


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json() or {}
    first_name = data.get('first_name', '').strip()
    last_name = data.get('last_name', '').strip()
    email = data.get('email', '').strip().lower()
    password = data.get('password', '')

    if not first_name or not last_name or not email or not password:
        return jsonify({'error': 'All fields are required.'}), 400

    if not validate_name(first_name) or not validate_name(last_name):
        return jsonify({'error': 'Names can only contain letters, spaces, hyphens, and apostrophes.'}), 400

    if not validate_email(email):
        return jsonify({'error': 'Please enter a valid email address.'}), 400

    if len(password) < 8:
        return jsonify({'error': 'Password must be at least 8 characters.'}), 400

    try:
        get_users().insert_one({
            'user_id': str(uuid.uuid4()),
            'email': email,
            'first_name': first_name,
            'last_name': last_name,
            'password_hash': generate_password_hash(password)
        })
    except DuplicateKeyError:
        return jsonify({'error': 'An account with that email already exists.'}), 409

    session['email'] = email
    session['first_name'] = first_name
    session['last_name'] = last_name

    return jsonify({'success': True, 'user': {
        'first_name': first_name,
        'last_name': last_name,
        'email': email
    }})


@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json() or {}
    email = data.get('email', '').strip().lower()
    password = data.get('password', '')

    if not email or not password:
        return jsonify({'error': 'Please enter your email and password.'}), 400

    if not validate_email(email):
        return jsonify({'error': 'Please enter a valid email address.'}), 400

    user = get_users().find_one({'email': email})

    if user is None or not check_password_hash(user['password_hash'], password):
        return jsonify({'error': 'Invalid email or password.'}), 401

    session['email'] = user['email']
    session['first_name'] = user['first_name']
    session['last_name'] = user['last_name']

    return jsonify({'success': True, 'user': {
        'first_name': user['first_name'],
        'last_name': user['last_name'],
        'email': user['email']
    }})


@app.route('/api/me')
def me():
    if 'email' in session:
        return jsonify({'logged_in': True, 'user': {
            'first_name': session['first_name'],
            'last_name': session['last_name'],
            'email': session['email']
        }})
    return jsonify({'logged_in': False})


@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'success': True})


@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', debug=os.environ.get('FLASK_DEBUG', 'false').lower() == 'true')
