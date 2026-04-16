from flask import Flask, request, jsonify, session, render_template
from werkzeug.security import generate_password_hash, check_password_hash
from botocore.exceptions import ClientError
import boto3
import uuid
import os
import re

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'fitlog-dev-secret-key')

# Session configuration for security
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['PERMANENT_SESSION_LIFETIME'] = 3600  # 1 hour

TABLE_NAME = 'fitlog-users'


def get_dynamodb():
    kwargs = {'region_name': os.environ.get('AWS_DEFAULT_REGION', 'us-east-1')}
    endpoint = os.environ.get('DYNAMODB_ENDPOINT_URL')
    if endpoint:
        kwargs['endpoint_url'] = endpoint
    return boto3.resource('dynamodb', **kwargs)


def get_table():
    return get_dynamodb().Table(TABLE_NAME)


def validate_name(name):
    """Validate name input - allow only letters, spaces, hyphens, apostrophes"""
    if not name or len(name) > 50:
        return False
    return bool(re.match(r"^[a-zA-Z\s\-']+$", name))


def validate_email(email):
    """Basic email validation"""
    if not email or len(email) > 254:
        return False
    # Simple regex for email validation
    return bool(re.match(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$', email))


def init_db():
    dynamodb = get_dynamodb()
    try:
        dynamodb.create_table(
            TableName=TABLE_NAME,
            KeySchema=[
                {'AttributeName': 'email', 'KeyType': 'HASH'}
            ],
            AttributeDefinitions=[
                {'AttributeName': 'email', 'AttributeType': 'S'}
            ],
            BillingMode='PAY_PER_REQUEST'
        )
        dynamodb.Table(TABLE_NAME).wait_until_exists()
    except ClientError as e:
        if e.response['Error']['Code'] != 'ResourceInUseException':
            raise


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json()
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

    table = get_table()
    try:
        table.put_item(
            Item={
                'user_id': str(uuid.uuid4()),
                'email': email,
                'first_name': first_name,
                'last_name': last_name,
                'password_hash': generate_password_hash(password)
            },
            ConditionExpression='attribute_not_exists(email)'
        )
    except ClientError as e:
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            return jsonify({'error': 'An account with that email already exists.'}), 409
        raise

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
    data = request.get_json()
    email = data.get('email', '').strip().lower()
    password = data.get('password', '')

    if not email or not password:
        return jsonify({'error': 'Please enter your email and password.'}), 400
    
    if not validate_email(email):
        return jsonify({'error': 'Please enter a valid email address.'}), 400

    table = get_table()
    response = table.get_item(Key={'email': email})
    user = response.get('Item')

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
    app.run(debug=True)
