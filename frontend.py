from flask import Flask, render_template
import os

app = Flask(__name__)

BACKEND_URL = os.environ.get('BACKEND_URL', '').rstrip('/')

@app.route('/')
def index():
    return render_template('index.html', api_base=BACKEND_URL)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
