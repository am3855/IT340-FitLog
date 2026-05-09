from flask import Flask, request, jsonify, session, render_template
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
from pymongo import MongoClient, ReturnDocument
from pymongo.errors import DuplicateKeyError
from bson import ObjectId
from dotenv import load_dotenv
import uuid
import os
import re
import random
import smtplib
from email.mime.text import MIMEText
from datetime import datetime, timedelta

load_dotenv()

try:
    import requests as http_requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'fitlog-dev-secret-key')

FRONTEND_ORIGIN = os.environ.get('FRONTEND_ORIGIN', '')
CORS(app, origins=FRONTEND_ORIGIN or '*', supports_credentials=True)

app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['PERMANENT_SESSION_LIFETIME'] = 3600

MONGO_HOST = os.environ.get('MONGO_HOST', 'localhost')
MONGO_PORT = int(os.environ.get('MONGO_PORT', '27017'))
MONGO_DB   = os.environ.get('MONGO_DB', 'fitlog')

WGER_BASE = 'https://wger.de/api/v2'

# To use Gmail SMTP: go to myaccount.google.com -> Security ->
# 2-Step Verification -> App Passwords -> generate one for "Mail"
# and put it in MAIL_PASSWORD in your .env file
MAIL_EMAIL    = os.environ.get('MAIL_EMAIL', '')
MAIL_PASSWORD = os.environ.get('MAIL_PASSWORD', '')

_client = MongoClient(MONGO_HOST, MONGO_PORT)


def get_db():
    return _client[MONGO_DB]


def get_users():
    return get_db()['users']


def get_workouts():
    return get_db()['workouts']


def require_login():
    if 'email' not in session:
        return jsonify({'error': 'Authentication required.'}), 401
    return None


def require_admin():
    if 'email' not in session:
        return jsonify({'error': 'Authentication required.'}), 401
    if not session.get('is_admin', False):
        return jsonify({'error': 'Admin access required.'}), 403
    return None


def validate_name(name):
    if not name or len(name) > 50:
        return False
    return bool(re.match(r"^[a-zA-Z\s\-']+$", name))


def validate_username(username):
    if not username or len(username) > 30:
        return False
    return bool(re.match(r'^[a-zA-Z0-9_.\-]+$', username))


def validate_email(email):
    if not email or len(email) > 254:
        return False
    return bool(re.match(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$', email))


def serialize_workout(w):
    return {
        'id': str(w['_id']),
        'exercise': w.get('exercise', ''),
        'sets': w.get('sets', 0),
        'reps': w.get('reps', 0),
        'weight': w.get('weight', 0),
        'duration': w.get('duration', 0),
        'date': w.get('date', ''),
        'user_email': w.get('user_email', ''),
    }


def _strip_html(text):
    if not text:
        return ''
    clean = re.sub(r'<[^>]+>', ' ', text)
    for entity, char in [('&nbsp;', ' '), ('&amp;', '&'), ('&lt;', '<'),
                          ('&gt;', '>'), ('&quot;', '"'), ('&#39;', "'")]:
        clean = clean.replace(entity, char)
    return ' '.join(clean.split())


def send_2fa_email(to_email, code):
    if not MAIL_EMAIL or not MAIL_PASSWORD:
        raise RuntimeError('Email credentials not configured (MAIL_EMAIL / MAIL_PASSWORD missing in .env).')
    body = (
        f'Your FitLog login verification code is: {code}\n\n'
        'This code expires in 10 minutes.\n'
        'If you did not request this, please ignore this email.'
    )
    msg = MIMEText(body)
    msg['Subject'] = 'Your FitLog verification code'
    msg['From']    = MAIL_EMAIL
    msg['To']      = to_email
    with smtplib.SMTP('smtp.gmail.com', 587) as smtp:
        smtp.ehlo()
        smtp.starttls()
        smtp.login(MAIL_EMAIL, MAIL_PASSWORD)
        smtp.sendmail(MAIL_EMAIL, to_email, msg.as_string())


def _create_session(user):
    session['email']       = user['email']
    session['username']    = user.get('username', '')
    session['first_name']  = user['first_name']
    session['last_name']   = user['last_name']
    session['is_admin']    = user.get('is_admin', False)
    session['2fa_enabled'] = user.get('2fa_enabled', False)


def _serialize_user(user):
    created_at = user.get('created_at')
    return {
        'user_id':    user.get('user_id', ''),
        'username':   user.get('username', ''),
        'first_name': user['first_name'],
        'last_name':  user['last_name'],
        'email':      user['email'],
        'is_admin':   user.get('is_admin', False),
        '2fa_enabled': user.get('2fa_enabled', False),
        'created_at': created_at.isoformat() if created_at else None,
    }


def init_db():
    users = get_users()
    users.create_index('email', unique=True)
    # Remove stale fields from old integrations
    users.update_many({}, {'$unset': {
        'fitbit_access_token': '',
        'fitbit_refresh_token': '',
        'duo_2fa_enabled': '',
        'duo_username': '',
    }})
    # Backfill username for existing users that don't have one
    for u in users.find({'username': {'$exists': False}}):
        base = re.sub(r'[^a-z0-9]', '', (u.get('first_name', '') + u.get('last_name', '')).lower()) or 'user'
        candidate, suffix = base, 1
        while users.find_one({'username': candidate, '_id': {'$ne': u['_id']}}):
            candidate = base + str(suffix)
            suffix += 1
        users.update_one({'_id': u['_id']}, {'$set': {'username': candidate}})
    # Backfill created_at for existing users (set to None if missing)
    users.update_many({'created_at': {'$exists': False}}, {'$set': {'created_at': None}})
    if not users.find_one({'email': 'admin@fitlog.com'}):
        users.insert_one({
            'user_id':       str(uuid.uuid4()),
            'email':         'admin@fitlog.com',
            'username':      'admin',
            'first_name':    'Admin',
            'last_name':     'FitLog',
            'password_hash': generate_password_hash('Admin123!'),
            'is_admin':      True,
            '2fa_enabled':   False,
            'created_at':    datetime.utcnow(),
        })


# ---------------------------------------------------------------------------
# Core routes
# ---------------------------------------------------------------------------

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/register', methods=['POST'])
def register():
    data       = request.get_json() or {}
    first_name = data.get('first_name', '').strip()
    last_name  = data.get('last_name', '').strip()
    email      = data.get('email', '').strip().lower()
    password   = data.get('password', '')

    if not first_name or not last_name or not email or not password:
        return jsonify({'error': 'All fields are required.'}), 400
    if not validate_name(first_name) or not validate_name(last_name):
        return jsonify({'error': 'Names can only contain letters, spaces, hyphens, and apostrophes.'}), 400
    if not validate_email(email):
        return jsonify({'error': 'Please enter a valid email address.'}), 400
    if len(password) < 8:
        return jsonify({'error': 'Password must be at least 8 characters.'}), 400

    base_username = re.sub(r'[^a-z0-9]', '', (first_name + last_name).lower()) or 'user'
    username, suffix = base_username, 1
    while get_users().find_one({'username': username}):
        username = base_username + str(suffix)
        suffix += 1

    try:
        get_users().insert_one({
            'user_id':       str(uuid.uuid4()),
            'email':         email,
            'username':      username,
            'first_name':    first_name,
            'last_name':     last_name,
            'password_hash': generate_password_hash(password),
            'is_admin':      False,
            '2fa_enabled':   False,
            'created_at':    datetime.utcnow(),
        })
    except DuplicateKeyError:
        return jsonify({'error': 'An account with that email already exists.'}), 409

    user = get_users().find_one({'email': email})
    _create_session(user)
    return jsonify({'success': True, 'user': _serialize_user(user)})


@app.route('/api/login', methods=['POST'])
def login():
    data     = request.get_json() or {}
    email    = data.get('email', '').strip().lower()
    password = data.get('password', '')

    if not email or not password:
        return jsonify({'error': 'Please enter your email and password.'}), 400
    if not validate_email(email):
        return jsonify({'error': 'Please enter a valid email address.'}), 400

    user = get_users().find_one({'email': email})
    if user is None or not check_password_hash(user['password_hash'], password):
        return jsonify({'error': 'Invalid email or password.'}), 401

    if user.get('2fa_enabled', False):
        code    = str(random.randint(100000, 999999))
        expires = datetime.utcnow() + timedelta(minutes=10)
        get_users().update_one(
            {'email': email},
            {'$set': {'2fa_code': code, '2fa_expires': expires}},
        )
        try:
            send_2fa_email(email, code)
        except Exception as exc:
            return jsonify({'error': f'Failed to send verification email: {exc}'}), 502

        session['pending_2fa_email'] = email
        return jsonify({'success': True, 'requires_2fa': True})

    _create_session(user)
    return jsonify({'success': True, 'requires_2fa': False, 'user': _serialize_user(user)})


@app.route('/api/me')
def me():
    if 'email' not in session:
        return jsonify({'logged_in': False})
    user = get_users().find_one({'email': session['email']})
    if not user:
        session.clear()
        return jsonify({'logged_in': False})
    return jsonify({'logged_in': True, 'user': _serialize_user(user)})


@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'success': True})


# ---------------------------------------------------------------------------
# Workout routes
# ---------------------------------------------------------------------------

@app.route('/api/workouts', methods=['POST'])
def create_workout():
    err = require_login()
    if err:
        return err

    data     = request.get_json()
    exercise = data.get('exercise', '').strip()
    sets     = data.get('sets')
    reps     = data.get('reps')
    weight   = data.get('weight', 0)
    duration = data.get('duration', 0)
    date     = data.get('date', '').strip()

    if not exercise or sets is None or reps is None or not date:
        return jsonify({'error': 'Exercise, sets, reps, and date are required.'}), 400

    try:
        sets     = int(sets)
        reps     = int(reps)
        weight   = float(weight)
        duration = int(duration)
    except (ValueError, TypeError):
        return jsonify({'error': 'Sets, reps, weight, and duration must be numbers.'}), 400

    if sets <= 0 or reps <= 0:
        return jsonify({'error': 'Sets and reps must be positive.'}), 400

    result  = get_workouts().insert_one({
        'user_email': session['email'],
        'exercise': exercise,
        'sets': sets,
        'reps': reps,
        'weight': weight,
        'duration': duration,
        'date': date,
    })
    workout = get_workouts().find_one({'_id': result.inserted_id})
    return jsonify({'success': True, 'workout': serialize_workout(workout)}), 201


@app.route('/api/workouts', methods=['GET'])
def get_user_workouts():
    err = require_login()
    if err:
        return err
    workouts = list(get_workouts().find({'user_email': session['email']}).sort('date', -1))
    return jsonify({'workouts': [serialize_workout(w) for w in workouts]})


# ---------------------------------------------------------------------------
# Admin routes
# ---------------------------------------------------------------------------

@app.route('/api/admin/users', methods=['GET'])
def admin_get_users():
    err = require_admin()
    if err:
        return err

    users  = list(get_users().find({}, {'password_hash': 0}))
    result = []
    for u in users:
        user_workouts = list(get_workouts().find({'user_email': u['email']}))
        result.append({
            'user_id': u.get('user_id', ''),
            'username': u.get('username', ''),
            'email': u.get('email', ''),
            'first_name': u.get('first_name', ''),
            'last_name': u.get('last_name', ''),
            'is_admin': u.get('is_admin', False),
            '2fa_enabled': u.get('2fa_enabled', False),
            'workouts': [serialize_workout(w) for w in user_workouts],
        })
    return jsonify({'users': result})


@app.route('/api/admin/workouts/<workout_id>', methods=['PUT'])
def admin_update_workout(workout_id):
    err = require_admin()
    if err:
        return err

    try:
        oid = ObjectId(workout_id)
    except Exception:
        return jsonify({'error': 'Invalid workout ID.'}), 400

    data    = request.get_json()
    updates = {}
    if 'exercise' in data:
        updates['exercise'] = str(data['exercise']).strip()
    if 'sets' in data:
        try:
            updates['sets'] = int(data['sets'])
        except (ValueError, TypeError):
            return jsonify({'error': 'Sets must be a number.'}), 400
    if 'reps' in data:
        try:
            updates['reps'] = int(data['reps'])
        except (ValueError, TypeError):
            return jsonify({'error': 'Reps must be a number.'}), 400
    if 'weight' in data:
        try:
            updates['weight'] = float(data['weight'])
        except (ValueError, TypeError):
            return jsonify({'error': 'Weight must be a number.'}), 400
    if 'duration' in data:
        try:
            updates['duration'] = int(data['duration'])
        except (ValueError, TypeError):
            return jsonify({'error': 'Duration must be a number.'}), 400
    if 'date' in data:
        updates['date'] = str(data['date']).strip()

    workout = get_workouts().find_one_and_update(
        {'_id': oid},
        {'$set': updates},
        return_document=ReturnDocument.AFTER,
    )
    if not workout:
        return jsonify({'error': 'Workout not found.'}), 404
    return jsonify({'success': True, 'workout': serialize_workout(workout)})


@app.route('/api/admin/workouts/<workout_id>', methods=['DELETE'])
def admin_delete_workout(workout_id):
    err = require_admin()
    if err:
        return err

    try:
        oid = ObjectId(workout_id)
    except Exception:
        return jsonify({'error': 'Invalid workout ID.'}), 400

    result = get_workouts().delete_one({'_id': oid})
    if result.deleted_count == 0:
        return jsonify({'error': 'Workout not found.'}), 404
    return jsonify({'success': True})


# ---------------------------------------------------------------------------
# Wger API proxy routes
# ---------------------------------------------------------------------------

@app.route('/api/exercises', methods=['GET'])
def get_exercises():
    err = require_login()
    if err:
        return err
    if not REQUESTS_AVAILABLE:
        return jsonify({'error': 'requests library not available.'}), 503
    try:
        resp = http_requests.get(
            f'{WGER_BASE}/exercise/',
            params={'format': 'json', 'language': 2, 'limit': 20},
            timeout=8,
        )
        if resp.status_code != 200:
            return jsonify({'error': 'Failed to fetch exercises from Wger.'}), 502
        exercises = [
            {
                'id': ex.get('id') or ex.get('base'),
                'name': ex.get('name', '').strip(),
                'description': _strip_html(ex.get('description', '')),
            }
            for ex in resp.json().get('results', [])
            if ex.get('name', '').strip()
        ]
        return jsonify({'exercises': exercises})
    except Exception as exc:
        return jsonify({'error': f'Wger request failed: {exc}'}), 502


@app.route('/api/exercises/search', methods=['GET'])
def search_exercises():
    err = require_login()
    if err:
        return err
    if not REQUESTS_AVAILABLE:
        return jsonify({'error': 'requests library not available.'}), 503
    term = request.args.get('term', '').strip()
    if not term:
        return jsonify({'exercises': []})
    try:
        resp = http_requests.get(
            f'{WGER_BASE}/exercise/search/',
            params={'term': term, 'language': 'english', 'format': 'json'},
            timeout=8,
        )
        if resp.status_code != 200:
            return jsonify({'exercises': []})
        exercises = [
            {
                'id': s.get('data', {}).get('base_id'),
                'name': s.get('value', '').strip(),
            }
            for s in resp.json().get('suggestions', [])
            if s.get('value', '').strip()
        ]
        return jsonify({'exercises': exercises})
    except Exception:
        return jsonify({'exercises': []})


@app.route('/api/muscles', methods=['GET'])
def get_muscles():
    err = require_login()
    if err:
        return err
    if not REQUESTS_AVAILABLE:
        return jsonify({'error': 'requests library not available.'}), 503
    try:
        resp = http_requests.get(
            f'{WGER_BASE}/muscle/',
            params={'format': 'json'},
            timeout=8,
        )
        if resp.status_code != 200:
            return jsonify({'error': 'Failed to fetch muscles from Wger.'}), 502
        muscles = [
            {
                'id': m.get('id'),
                'name': m.get('name_en') or m.get('name', ''),
            }
            for m in resp.json().get('results', [])
            if m.get('name_en') or m.get('name')
        ]
        return jsonify({'muscles': muscles})
    except Exception as exc:
        return jsonify({'error': f'Wger request failed: {exc}'}), 502


@app.route('/api/exercises/by-muscle', methods=['GET'])
def get_exercises_by_muscle():
    err = require_login()
    if err:
        return err
    if not REQUESTS_AVAILABLE:
        return jsonify({'error': 'requests library not available.'}), 503
    muscle_id = request.args.get('muscle_id', '').strip()
    if not muscle_id:
        return jsonify({'error': 'muscle_id is required.'}), 400
    try:
        muscle_id = int(muscle_id)
    except ValueError:
        return jsonify({'error': 'muscle_id must be a number.'}), 400
    try:
        resp = http_requests.get(
            f'{WGER_BASE}/exercise/',
            params={'format': 'json', 'language': 2, 'muscles': muscle_id, 'limit': 20},
            timeout=8,
        )
        if resp.status_code != 200:
            return jsonify({'error': 'Failed to fetch exercises from Wger.'}), 502
        exercises = [
            {
                'id': ex.get('id') or ex.get('base'),
                'name': ex.get('name', '').strip(),
                'description': _strip_html(ex.get('description', '')),
            }
            for ex in resp.json().get('results', [])
            if ex.get('name', '').strip()
        ]
        return jsonify({'exercises': exercises})
    except Exception as exc:
        return jsonify({'error': f'Wger request failed: {exc}'}), 502


# ---------------------------------------------------------------------------
# Admin user management routes
# ---------------------------------------------------------------------------

@app.route('/api/admin/users/<user_id>/toggle-2fa', methods=['PUT'])
def admin_toggle_2fa(user_id):
    err = require_admin()
    if err:
        return err

    user = get_users().find_one({'user_id': user_id})
    if not user:
        return jsonify({'error': 'User not found.'}), 404

    new_val = not user.get('2fa_enabled', False)
    update = {'$set': {'2fa_enabled': new_val}}
    if not new_val:
        update['$unset'] = {'2fa_code': '', '2fa_expires': ''}
    get_users().update_one({'user_id': user_id}, update)
    return jsonify({'success': True, '2fa_enabled': new_val})


@app.route('/api/admin/users/<user_id>/email', methods=['PUT'])
def admin_update_email(user_id):
    err = require_admin()
    if err:
        return err

    data  = request.get_json() or {}
    email = data.get('email', '').strip().lower()
    if not validate_email(email):
        return jsonify({'error': 'Invalid email address.'}), 400

    user = get_users().find_one({'user_id': user_id})
    if not user:
        return jsonify({'error': 'User not found.'}), 404

    if get_users().find_one({'email': email, 'user_id': {'$ne': user_id}}):
        return jsonify({'error': 'That email is already in use.'}), 409

    old_email = user['email']
    get_users().update_one({'user_id': user_id}, {'$set': {'email': email}})
    get_workouts().update_many({'user_email': old_email}, {'$set': {'user_email': email}})
    return jsonify({'success': True, 'email': email})


@app.route('/api/admin/users/<user_id>/username', methods=['PUT'])
def admin_update_username(user_id):
    err = require_admin()
    if err:
        return err

    data     = request.get_json() or {}
    username = data.get('username', '').strip()
    if not validate_username(username):
        return jsonify({'error': 'Username must be 1-30 characters (letters, numbers, _ . -)'}), 400

    if not get_users().find_one({'user_id': user_id}):
        return jsonify({'error': 'User not found.'}), 404

    if get_users().find_one({'username': username, 'user_id': {'$ne': user_id}}):
        return jsonify({'error': 'That username is already taken.'}), 409

    get_users().update_one({'user_id': user_id}, {'$set': {'username': username}})
    return jsonify({'success': True, 'username': username})


# ---------------------------------------------------------------------------
# User self-service routes
# ---------------------------------------------------------------------------

@app.route('/api/user/username', methods=['PUT'])
def user_update_username():
    err = require_login()
    if err:
        return err

    data     = request.get_json() or {}
    username = data.get('username', '').strip()
    if not validate_username(username):
        return jsonify({'error': 'Username must be 1-30 characters (letters, numbers, _ . -)'}), 400

    if get_users().find_one({'username': username, 'email': {'$ne': session['email']}}):
        return jsonify({'error': 'That username is already taken.'}), 409

    get_users().update_one({'email': session['email']}, {'$set': {'username': username}})
    session['username'] = username
    return jsonify({'success': True, 'username': username})


@app.route('/api/user/email', methods=['PUT'])
def user_update_email():
    err = require_login()
    if err:
        return err

    data      = request.get_json() or {}
    new_email = data.get('email', '').strip().lower()
    if not validate_email(new_email):
        return jsonify({'error': 'Invalid email address.'}), 400

    if new_email != session['email'] and get_users().find_one({'email': new_email}):
        return jsonify({'error': 'That email is already in use.'}), 409

    old_email = session['email']
    get_users().update_one({'email': old_email}, {'$set': {'email': new_email}})
    get_workouts().update_many({'user_email': old_email}, {'$set': {'user_email': new_email}})
    session['email'] = new_email
    return jsonify({'success': True, 'email': new_email})


# ---------------------------------------------------------------------------
# Email 2FA routes
# ---------------------------------------------------------------------------

@app.route('/api/2fa/status', methods=['GET'])
def get_2fa_status():
    err = require_login()
    if err:
        return err
    return jsonify({'2fa_enabled': session.get('2fa_enabled', False)})


@app.route('/api/2fa/verify', methods=['POST'])
def verify_2fa():
    data  = request.get_json()
    email = data.get('email', '').strip().lower()
    code  = str(data.get('code', '')).strip()

    if not email or not code:
        return jsonify({'error': 'Email and code are required.'}), 400

    user = get_users().find_one({'email': email})
    if not user:
        return jsonify({'error': 'Invalid or expired code.'}), 401

    stored_code    = user.get('2fa_code', '')
    stored_expires = user.get('2fa_expires')

    if not stored_code or not stored_expires:
        return jsonify({'error': 'No verification code found. Please log in again.'}), 401

    if datetime.utcnow() > stored_expires:
        get_users().update_one({'email': email}, {'$unset': {'2fa_code': '', '2fa_expires': ''}})
        return jsonify({'error': 'Code expired, please log in again.'}), 401

    if code != stored_code:
        return jsonify({'error': 'Invalid or expired code.'}), 401

    get_users().update_one({'email': email}, {'$unset': {'2fa_code': '', '2fa_expires': ''}})
    session.pop('pending_2fa_email', None)
    _create_session(user)
    return jsonify({'success': True, 'user': _serialize_user(user)})


@app.route('/api/2fa/resend', methods=['POST'])
def resend_2fa():
    pending_email = session.get('pending_2fa_email')
    if not pending_email:
        return jsonify({'error': 'No pending 2FA session. Please log in again.'}), 400

    user = get_users().find_one({'email': pending_email})
    if not user:
        return jsonify({'error': 'User not found.'}), 404

    code    = str(random.randint(100000, 999999))
    expires = datetime.utcnow() + timedelta(minutes=10)
    get_users().update_one(
        {'email': pending_email},
        {'$set': {'2fa_code': code, '2fa_expires': expires}},
    )
    try:
        send_2fa_email(pending_email, code)
    except Exception as exc:
        return jsonify({'error': f'Failed to send verification email: {exc}'}), 502

    return jsonify({'success': True})


@app.route('/api/2fa/enroll', methods=['POST'])
def enroll_2fa():
    err = require_login()
    if err:
        return err
    data   = request.get_json()
    enable = bool(data.get('enable', True))
    get_users().update_one(
        {'email': session['email']},
        {'$set': {'2fa_enabled': enable}},
    )
    session['2fa_enabled'] = enable
    return jsonify({'success': True, '2fa_enabled': enable})


@app.route('/api/2fa/disable', methods=['POST'])
def disable_2fa():
    err = require_login()
    if err:
        return err
    get_users().update_one(
        {'email': session['email']},
        {'$set': {'2fa_enabled': False}, '$unset': {'2fa_code': '', '2fa_expires': ''}},
    )
    session['2fa_enabled'] = False
    return jsonify({'success': True, '2fa_enabled': False})


# ---------------------------------------------------------------------------
# Security headers
# ---------------------------------------------------------------------------

@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', debug=os.environ.get('FLASK_DEBUG', 'false').lower() == 'true')
