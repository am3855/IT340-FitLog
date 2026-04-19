function showView(name) {
  document.querySelectorAll('#view-login, #view-register, #view-dashboard').forEach(function(el) {
    el.classList.add('hidden');
  });
  document.getElementById('view-' + name).classList.remove('hidden');
}

function setUser(user) {
  document.getElementById('nav-username').textContent = user.first_name + ' ' + user.last_name;
}

function showError(id, message) {
  var box = document.getElementById(id);
  box.textContent = message;
  box.style.display = 'block';
}

function hideError(id) {
  document.getElementById(id).style.display = 'none';
}

function checkStrength(val) {
  var segs = ['seg1', 'seg2', 'seg3', 'seg4'].map(function(id) {
    return document.getElementById(id);
  });
  var label = document.getElementById('strength-label');

  segs.forEach(function(s) { s.className = 'strength-seg'; });

  if (val.length === 0) {
    label.textContent = 'Enter a password';
    return;
  }

  var score = 0;
  if (val.length >= 8) score++;
  if (/[A-Z]/.test(val)) score++;
  if (/[0-9]/.test(val)) score++;
  if (/[^A-Za-z0-9]/.test(val)) score++;

  var cls = score <= 1 ? 'low' : score <= 2 ? 'med' : 'high';
  var labels = ['', 'Weak', 'Weak', 'Good', 'Strong'];

  for (var i = 0; i < score; i++) segs[i].classList.add(cls);
  label.textContent = 'Password strength: ' + (labels[score] || 'Weak');
}

var API_BASE = window.API_BASE || '';

async function checkAuth() {
  var res = await fetch(API_BASE + '/api/me', { credentials: 'include' });
  var data = await res.json();
  if (data.logged_in) {
    setUser(data.user);
    showView('dashboard');
  } else {
    showView('login');
  }
}

async function handleLogin() {
  hideError('login-error');
  var email = document.getElementById('login-email').value.trim();
  var password = document.getElementById('login-password').value;

  var res = await fetch(API_BASE + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email: email, password: password })
  });
  var data = await res.json();

  if (!res.ok) {
    showError('login-error', data.error);
    return;
  }

  setUser(data.user);
  showView('dashboard');
}

async function handleRegister() {
  hideError('register-error');
  var firstName = document.getElementById('reg-first').value.trim();
  var lastName = document.getElementById('reg-last').value.trim();
  var email = document.getElementById('reg-email').value.trim();
  var password = document.getElementById('reg-password').value;
  var confirm = document.getElementById('reg-confirm').value;
  var terms = document.getElementById('reg-terms').checked;

  if (!firstName || !lastName) {
    showError('register-error', 'Please enter your first and last name.');
    return;
  }
  if (!email) {
    showError('register-error', 'Please enter a valid email address.');
    return;
  }
  if (password.length < 8) {
    showError('register-error', 'Password must be at least 8 characters.');
    return;
  }
  if (password !== confirm) {
    showError('register-error', 'Passwords do not match.');
    return;
  }
  if (!terms) {
    showError('register-error', 'You must agree to the Terms of Service.');
    return;
  }

  var res = await fetch(API_BASE + '/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ first_name: firstName, last_name: lastName, email: email, password: password })
  });
  var data = await res.json();

  if (!res.ok) {
    showError('register-error', data.error);
    return;
  }

  setUser(data.user);
  showView('dashboard');
}

async function handleLogout() {
  await fetch(API_BASE + '/api/logout', { method: 'POST', credentials: 'include' });
  showView('login');
}

document.addEventListener('DOMContentLoaded', checkAuth);
