// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
var currentUser        = null;
var volumeChart        = null;
var frequencyChart     = null;
var bmiChart           = null;
var caloriesChart      = null;
var hrChart            = null;
var macroChart         = null;
var twoFaEnabled       = false;
var exerciseSearchTimer = null;
var pending2FAEmail    = null;
var cachedWorkouts     = [];

// ---------------------------------------------------------------------------
// View / panel routing
// ---------------------------------------------------------------------------
function showView(name) {
  ['login', 'register', 'dashboard', 'email2fa'].forEach(function (v) {
    var el = document.getElementById('view-' + v);
    if (el) el.classList.add('hidden');
  });
  var target = document.getElementById('view-' + name);
  if (target) target.classList.remove('hidden');
}

function showPanel(name) {
  ['workouts', 'admin', 'settings'].forEach(function (p) {
    var el = document.getElementById('panel-' + p);
    if (el) el.classList.add('hidden');
  });
  var target = document.getElementById('panel-' + name);
  if (target) target.classList.remove('hidden');

  if (name === 'admin') loadAdminPanel();
  if (name === 'settings') loadSettings();
}

// ---------------------------------------------------------------------------
// User state
// ---------------------------------------------------------------------------
function setUser(user) {
  currentUser = user;
  document.getElementById('nav-username').textContent =
    user.first_name + ' ' + user.last_name;

  document.querySelectorAll('.admin-only').forEach(function (el) {
    if (user.is_admin) {
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  });
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------
function showError(id, message) {
  var box = document.getElementById(id);
  if (!box) return;
  box.textContent = message;
  box.style.display = 'block';
}

function hideError(id) {
  var box = document.getElementById(id);
  if (box) box.style.display = 'none';
}

// ---------------------------------------------------------------------------
// HTML escaping (XSS prevention)
// ---------------------------------------------------------------------------
function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

function escapeAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// Password strength meter
// ---------------------------------------------------------------------------
function checkStrength(val) {
  var segs = ['seg1', 'seg2', 'seg3', 'seg4'].map(function (id) {
    return document.getElementById(id);
  });
  var label = document.getElementById('strength-label');

  segs.forEach(function (s) { s.className = 'strength-seg'; });

  if (val.length === 0) { label.textContent = 'Enter a password'; return; }

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

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
async function checkAuth() {
  var res  = await fetch('/api/me');
  var data = await res.json();
  if (data.logged_in) {
    setUser(data.user);
    showView('dashboard');
    showPanel('workouts');
    await loadWorkouts();
    loadMuscles();
    load2FAStatus();
  } else {
    showView('login');
  }
}

async function handleLogin() {
  hideError('login-error');
  var email    = document.getElementById('login-email').value.trim();
  var password = document.getElementById('login-password').value;

  var res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email, password: password }),
  });
  var data = await res.json();

  if (!res.ok) {
    showError('login-error', data.error);
    return;
  }

  if (data.requires_2fa) {
    pending2FAEmail = email;
    document.getElementById('email2fa-code').value = '';
    hideError('email2fa-error');
    showView('email2fa');
    return;
  }

  setUser(data.user);
  showView('dashboard');
  showPanel('workouts');
  await loadWorkouts();
  loadMuscles();
  load2FAStatus();
}

async function handleRegister() {
  hideError('register-error');
  var firstName = document.getElementById('reg-first').value.trim();
  var lastName  = document.getElementById('reg-last').value.trim();
  var email     = document.getElementById('reg-email').value.trim();
  var password  = document.getElementById('reg-password').value;
  var confirm   = document.getElementById('reg-confirm').value;
  var terms     = document.getElementById('reg-terms').checked;

  if (!firstName || !lastName) {
    showError('register-error', 'Please enter your first and last name.'); return;
  }
  if (!email) {
    showError('register-error', 'Please enter a valid email address.'); return;
  }
  if (password.length < 8) {
    showError('register-error', 'Password must be at least 8 characters.'); return;
  }
  if (password !== confirm) {
    showError('register-error', 'Passwords do not match.'); return;
  }
  if (!terms) {
    showError('register-error', 'You must agree to the Terms of Service.'); return;
  }

  var res = await fetch('/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      first_name: firstName, last_name: lastName,
      email: email, password: password,
    }),
  });
  var data = await res.json();

  if (!res.ok) {
    showError('register-error', data.error); return;
  }

  setUser(data.user);
  showView('dashboard');
  showPanel('workouts');
  await loadWorkouts();
  loadMuscles();
  load2FAStatus();
}

async function handleLogout() {
  await fetch('/api/logout', { method: 'POST' });
  currentUser     = null;
  pending2FAEmail = null;
  showView('login');
}

// ---------------------------------------------------------------------------
// Email 2FA
// ---------------------------------------------------------------------------
async function handleVerify2FA() {
  hideError('email2fa-error');
  var code = document.getElementById('email2fa-code').value.trim();
  if (!code || code.length !== 6) {
    showError('email2fa-error', 'Please enter the 6-digit code.');
    return;
  }

  var res = await fetch('/api/2fa/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: pending2FAEmail, code: code }),
  });
  var data = await res.json();

  if (!res.ok) {
    showError('email2fa-error', data.error);
    return;
  }

  pending2FAEmail = null;
  setUser(data.user);
  showView('dashboard');
  showPanel('workouts');
  await loadWorkouts();
  loadMuscles();
  load2FAStatus();
}

async function resendCode() {
  var link = document.getElementById('resend-link');
  if (link) { link.textContent = 'Sending…'; }

  var res  = await fetch('/api/2fa/resend', { method: 'POST' });
  var data = await res.json();

  if (!res.ok) {
    showError('email2fa-error', data.error || 'Failed to resend code.');
    if (link) link.textContent = 'Resend code';
  } else {
    hideError('email2fa-error');
    if (link) {
      link.textContent = 'Sent!';
      setTimeout(function () { link.textContent = 'Resend code'; }, 3000);
    }
  }
}

// ---------------------------------------------------------------------------
// Workout form
// ---------------------------------------------------------------------------
function toggleWorkoutForm() {
  var card = document.getElementById('workout-form-card');
  card.classList.toggle('hidden');
  if (!card.classList.contains('hidden')) {
    var dateInput = document.getElementById('wf-date');
    if (!dateInput.value) {
      dateInput.value = new Date().toISOString().split('T')[0];
    }
    hideError('workout-error');
  }
}

async function handleWorkoutSubmit() {
  hideError('workout-error');
  var exercise = document.getElementById('wf-exercise').value.trim();
  var date     = document.getElementById('wf-date').value;
  var sets     = document.getElementById('wf-sets').value;
  var reps     = document.getElementById('wf-reps').value;
  var weight   = document.getElementById('wf-weight').value || '0';
  var duration = document.getElementById('wf-duration').value || '0';

  if (!exercise || !date || !sets || !reps) {
    showError('workout-error', 'Exercise, date, sets, and reps are required.');
    return;
  }

  var res = await fetch('/api/workouts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      exercise: exercise,
      date: date,
      sets: parseInt(sets, 10),
      reps: parseInt(reps, 10),
      weight: parseFloat(weight),
      duration: parseInt(duration, 10),
    }),
  });
  var data = await res.json();

  if (!res.ok) {
    showError('workout-error', data.error); return;
  }

  ['wf-exercise', 'wf-sets', 'wf-reps', 'wf-weight', 'wf-duration'].forEach(function (id) {
    document.getElementById(id).value = '';
  });
  toggleWorkoutForm();
  await loadWorkouts();
}

// ---------------------------------------------------------------------------
// Load & render workouts
// ---------------------------------------------------------------------------
async function loadWorkouts() {
  var res = await fetch('/api/workouts');
  if (!res.ok) return;
  var data     = await res.json();
  var workouts = data.workouts || [];
  cachedWorkouts = workouts;
  renderWorkouts(workouts);
  updateStats(workouts);
  renderCharts(workouts);
  renderHealthMetrics(workouts);
}

function renderWorkouts(workouts) {
  var tbody    = document.getElementById('workout-tbody');
  var weightKg = getWeightKg();
  if (!workouts.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-row">No workouts yet. Log your first one!</td></tr>';
    return;
  }
  tbody.innerHTML = workouts.map(function (w) {
    var volume = w.sets * w.reps * w.weight;
    var calCell = '&mdash;';
    if (weightKg && w.duration > 0) {
      calCell = Math.round(5 * weightKg * (w.duration / 60)) + ' kcal';
    }
    return '<tr>'
      + '<td>' + escapeHtml(w.date) + '</td>'
      + '<td><strong>' + escapeHtml(w.exercise) + '</strong></td>'
      + '<td>' + escapeHtml(w.sets) + ' &times; ' + escapeHtml(w.reps) + '</td>'
      + '<td>' + escapeHtml(w.weight) + ' lbs</td>'
      + '<td>' + volume.toLocaleString() + ' lbs</td>'
      + '<td>' + (w.duration ? escapeHtml(w.duration) + ' min' : '&mdash;') + '</td>'
      + '<td>' + calCell + '</td>'
      + '</tr>';
  }).join('');
}

function updateStats(workouts) {
  var total       = workouts.length;
  var totalVolume = workouts.reduce(function (sum, w) {
    return sum + w.sets * w.reps * w.weight;
  }, 0);

  var now       = new Date();
  var weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  weekStart.setHours(0, 0, 0, 0);
  var thisWeek = workouts.filter(function (w) {
    return new Date(w.date) >= weekStart;
  }).length;

  var streak      = 0;
  var dates       = workouts.map(function (w) { return w.date; });
  var uniqueDates = Array.from(new Set(dates)).sort().reverse();
  var check       = new Date();
  check.setHours(0, 0, 0, 0);
  for (var i = 0; i < uniqueDates.length; i++) {
    var d = new Date(uniqueDates[i]);
    d.setHours(0, 0, 0, 0);
    var diff = Math.round((check - d) / 86400000);
    if (diff === 0 || diff === streak) { streak++; check = d; }
    else break;
  }

  document.getElementById('stat-total-workouts').textContent = total;
  document.getElementById('stat-total-volume').textContent   = totalVolume.toLocaleString();
  document.getElementById('stat-this-week').textContent      = thisWeek;
  document.getElementById('stat-best-streak').textContent    = streak;
}

// ---------------------------------------------------------------------------
// Chart.js charts
// ---------------------------------------------------------------------------
function getWeekLabel(dateStr) {
  var d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().split('T')[0];
}

function renderCharts(workouts) {
  var volumeByDate = {};
  workouts.forEach(function (w) {
    var vol = w.sets * w.reps * w.weight;
    volumeByDate[w.date] = (volumeByDate[w.date] || 0) + vol;
  });
  var sortedDates = Object.keys(volumeByDate).sort();
  var volumes     = sortedDates.map(function (d) { return volumeByDate[d]; });

  var freqByWeek  = {};
  workouts.forEach(function (w) {
    var wk = getWeekLabel(w.date);
    freqByWeek[wk] = (freqByWeek[wk] || 0) + 1;
  });
  var sortedWeeks = Object.keys(freqByWeek).sort();
  var freqs       = sortedWeeks.map(function (wk) { return freqByWeek[wk]; });

  var chartDefaults = {
    plugins: { legend: { labels: { color: '#e8e8e8', font: { family: 'DM Sans' } } } },
    scales: {
      x: { ticks: { color: '#777', font: { family: 'DM Sans' } }, grid: { color: '#2a2a2a' } },
      y: { ticks: { color: '#777', font: { family: 'DM Sans' } }, grid: { color: '#2a2a2a' }, beginAtZero: true },
    },
    responsive: true,
    maintainAspectRatio: true,
  };

  if (volumeChart)    { volumeChart.destroy();    volumeChart    = null; }
  if (frequencyChart) { frequencyChart.destroy(); frequencyChart = null; }

  volumeChart = new Chart(document.getElementById('volume-chart').getContext('2d'), {
    type: 'line',
    data: {
      labels: sortedDates,
      datasets: [{
        label: 'Total Volume (lbs)',
        data: volumes,
        borderColor: '#b8f94f',
        backgroundColor: 'rgba(184,249,79,0.12)',
        pointBackgroundColor: '#b8f94f',
        tension: 0.35,
        fill: true,
      }],
    },
    options: chartDefaults,
  });

  frequencyChart = new Chart(document.getElementById('frequency-chart').getContext('2d'), {
    type: 'bar',
    data: {
      labels: sortedWeeks,
      datasets: [{
        label: 'Workouts per Week',
        data: freqs,
        backgroundColor: 'rgba(79,168,255,0.55)',
        borderColor: '#4fa8ff',
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
    options: chartDefaults,
  });
}

// ---------------------------------------------------------------------------
// Admin panel
// ---------------------------------------------------------------------------
async function loadAdminPanel() {
  var res = await fetch('/api/admin/users');
  if (!res.ok) {
    showError('admin-users-tbody', 'Failed to load admin data.'); return;
  }
  var data = await res.json();
  renderAdminUsers(data.users);
  renderAdminWorkouts(data.users);
}

function renderAdminUsers(users) {
  var tbody = document.getElementById('admin-users-tbody');
  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-row">No users found.</td></tr>';
    return;
  }
  tbody.innerHTML = users.map(function (u) {
    var uid = escapeAttr(u.user_id);
    // Compact metrics summary
    var unitLbl = u.unit_preference === 'metric' ? 'kg / cm' : 'lbs / in';
    var metricsSummary = (u.age || u.weight || u.height)
      ? [
          u.age    ? 'Age: '    + u.age    : null,
          u.weight ? 'Wt: '    + u.weight : null,
          u.height ? 'Ht: '    + u.height : null,
          '(' + unitLbl + ')',
        ].filter(Boolean).join(' | ')
      : '&mdash;';

    return '<tr>'
      + '<td>' + escapeHtml(u.first_name) + ' ' + escapeHtml(u.last_name) + '</td>'
      // Username inline edit
      + '<td>'
        + '<div id="u-disp-' + uid + '">'
          + '<span id="u-txt-' + uid + '">' + escapeHtml(u.username) + '</span>'
          + ' <button class="btn-ghost admin-btn" style="font-size:11px;padding:2px 6px;"'
          + ' data-uid="' + uid + '" data-type="username" onclick="adminStartEdit(this)">Edit</button>'
        + '</div>'
        + '<div id="u-form-' + uid + '" style="display:none;gap:4px;align-items:center;">'
          + '<input class="field-input" id="u-inp-' + uid + '" type="text"'
          + ' value="' + escapeAttr(u.username) + '"'
          + ' style="font-size:12px;padding:4px 8px;width:110px;">'
          + '<button class="btn-primary admin-btn" style="font-size:11px;padding:3px 8px;"'
          + ' data-uid="' + uid + '" data-type="username" onclick="adminSaveEdit(this)">Save</button>'
          + '<button class="btn-ghost admin-btn" style="font-size:11px;padding:3px 8px;"'
          + ' data-uid="' + uid + '" data-type="username" onclick="adminCancelEdit(this)">Cancel</button>'
        + '</div>'
      + '</td>'
      // Email inline edit
      + '<td>'
        + '<div id="e-disp-' + uid + '">'
          + '<span id="e-txt-' + uid + '">' + escapeHtml(u.email) + '</span>'
          + ' <button class="btn-ghost admin-btn" style="font-size:11px;padding:2px 6px;"'
          + ' data-uid="' + uid + '" data-type="email" onclick="adminStartEdit(this)">Edit</button>'
        + '</div>'
        + '<div id="e-form-' + uid + '" style="display:none;gap:4px;align-items:center;">'
          + '<input class="field-input" id="e-inp-' + uid + '" type="email"'
          + ' value="' + escapeAttr(u.email) + '"'
          + ' style="font-size:12px;padding:4px 8px;width:160px;">'
          + '<button class="btn-primary admin-btn" style="font-size:11px;padding:3px 8px;"'
          + ' data-uid="' + uid + '" data-type="email" onclick="adminSaveEdit(this)">Save</button>'
          + '<button class="btn-ghost admin-btn" style="font-size:11px;padding:3px 8px;"'
          + ' data-uid="' + uid + '" data-type="email" onclick="adminCancelEdit(this)">Cancel</button>'
        + '</div>'
      + '</td>'
      + '<td>' + (u.is_admin
        ? '<span class="badge badge-green">Admin</span>'
        : '<span class="badge badge-blue">User</span>') + '</td>'
      + '<td>' + escapeHtml(u.workouts.length) + '</td>'
      + '<td>' + admin2FACell(uid, u['2fa_enabled']) + '</td>'
      // Body Metrics inline edit
      + '<td style="min-width:160px;">'
        + '<div id="m-disp-' + uid + '">'
          + '<span id="m-txt-' + uid + '" style="font-size:11px;color:var(--muted);">' + metricsSummary + '</span>'
          + ' <button class="btn-ghost admin-btn" style="font-size:11px;padding:2px 6px;"'
          + ' data-uid="' + uid + '" onclick="adminStartMetricsEdit(this)">Edit</button>'
        + '</div>'
        + '<div id="m-form-' + uid + '" style="display:none;">'
          + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:4px;">'
            + '<input class="field-input" id="m-age-' + uid + '" type="number" min="1" placeholder="Age"'
            + ' value="' + escapeAttr(u.age || '') + '" style="font-size:11px;padding:4px 6px;">'
            + '<input class="field-input" id="m-weight-' + uid + '" type="number" min="0.1" step="0.1" placeholder="Weight"'
            + ' value="' + escapeAttr(u.weight || '') + '" style="font-size:11px;padding:4px 6px;">'
            + '<input class="field-input" id="m-height-' + uid + '" type="number" min="0.1" step="0.1" placeholder="Height"'
            + ' value="' + escapeAttr(u.height || '') + '" style="font-size:11px;padding:4px 6px;">'
            + '<select class="field-input" id="m-unit-' + uid + '" style="font-size:11px;padding:4px 6px;">'
              + '<option value="imperial"' + (u.unit_preference !== 'metric' ? ' selected' : '') + '>Imperial</option>'
              + '<option value="metric"'   + (u.unit_preference === 'metric'  ? ' selected' : '') + '>Metric</option>'
            + '</select>'
            + '<select class="field-input" id="m-gender-' + uid + '" style="font-size:11px;padding:4px 6px;">'
              + '<option value=""'       + (!u.gender || u.gender === ''       ? ' selected' : '') + '>N/A</option>'
              + '<option value="male"'   + (u.gender === 'male'   ? ' selected' : '') + '>Male</option>'
              + '<option value="female"' + (u.gender === 'female' ? ' selected' : '') + '>Female</option>'
            + '</select>'
          + '</div>'
          + '<div style="display:flex;gap:4px;">'
            + '<button class="btn-primary admin-btn" style="font-size:11px;padding:3px 8px;"'
            + ' data-uid="' + uid + '" onclick="adminSaveMetrics(this)">Save</button>'
            + '<button class="btn-ghost admin-btn" style="font-size:11px;padding:3px 8px;"'
            + ' data-uid="' + uid + '" onclick="adminCancelMetricsEdit(this)">Cancel</button>'
          + '</div>'
        + '</div>'
      + '</td>'
      + '<td class="admin-feedback-cell"><span id="adminfb-' + uid + '"></span></td>'
      + '</tr>';
  }).join('');
}

function admin2FACell(uid, enabled) {
  return (enabled
    ? '<span class="badge badge-green">On</span>'
    : '<span class="badge badge-blue">Off</span>')
    + ' <button class="btn-ghost admin-btn" style="font-size:11px;padding:2px 6px;"'
    + ' data-uid="' + uid + '" onclick="adminToggle2FA(this)">Toggle</button>';
}

function adminStartEdit(btn) {
  var uid    = btn.dataset.uid;
  var type   = btn.dataset.type;
  var prefix = type === 'username' ? 'u' : 'e';
  document.getElementById(prefix + '-disp-' + uid).style.display = 'none';
  var form = document.getElementById(prefix + '-form-' + uid);
  form.style.display = 'flex';
}

function adminCancelEdit(btn) {
  var uid    = btn.dataset.uid;
  var type   = btn.dataset.type;
  var prefix = type === 'username' ? 'u' : 'e';
  document.getElementById(prefix + '-form-' + uid).style.display = 'none';
  document.getElementById(prefix + '-disp-' + uid).style.display = '';
}

async function adminSaveEdit(btn) {
  var uid    = btn.dataset.uid;
  var type   = btn.dataset.type;
  var prefix = type === 'username' ? 'u' : 'e';
  var val    = document.getElementById(prefix + '-inp-' + uid).value.trim();

  var body = {};
  body[type] = val;

  var res  = await fetch('/api/admin/users/' + uid + '/' + type, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  var data = await res.json();

  if (!res.ok) {
    adminShowFeedback(uid, data.error || 'Error saving.', false);
    return;
  }

  document.getElementById(prefix + '-txt-' + uid).textContent = val;
  document.getElementById(prefix + '-inp-' + uid).value = val;
  document.getElementById(prefix + '-form-' + uid).style.display = 'none';
  document.getElementById(prefix + '-disp-' + uid).style.display = '';
  adminShowFeedback(uid, (type === 'username' ? 'Username' : 'Email') + ' updated.', true);
}

async function adminToggle2FA(btn) {
  var uid = btn.dataset.uid;
  var res = await fetch('/api/admin/users/' + uid + '/toggle-2fa', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
  });
  var data = await res.json();

  if (!res.ok) {
    adminShowFeedback(uid, data.error || 'Failed to toggle 2FA.', false);
    return;
  }

  var cell = btn.closest('td');
  cell.innerHTML = admin2FACell(uid, data['2fa_enabled']);
  adminShowFeedback(uid, '2FA ' + (data['2fa_enabled'] ? 'enabled' : 'disabled') + '.', true);
}

function adminShowFeedback(uid, msg, success) {
  var el = document.getElementById('adminfb-' + uid);
  if (!el) return;
  el.textContent = msg;
  el.style.color = success ? 'var(--green)' : 'var(--red)';
  setTimeout(function () { if (el) el.textContent = ''; }, 4000);
}

function adminStartMetricsEdit(btn) {
  var uid = btn.dataset.uid;
  document.getElementById('m-disp-' + uid).style.display = 'none';
  document.getElementById('m-form-' + uid).style.display = '';
}

function adminCancelMetricsEdit(btn) {
  var uid = btn.dataset.uid;
  document.getElementById('m-form-' + uid).style.display = 'none';
  document.getElementById('m-disp-' + uid).style.display = '';
}

async function adminSaveMetrics(btn) {
  var uid    = btn.dataset.uid;
  var age    = parseFloat(document.getElementById('m-age-'    + uid).value) || null;
  var weight = parseFloat(document.getElementById('m-weight-' + uid).value) || null;
  var height = parseFloat(document.getElementById('m-height-' + uid).value) || null;
  var unit   = document.getElementById('m-unit-'   + uid).value;
  var gender = document.getElementById('m-gender-' + uid).value;

  var body = { unit_preference: unit, gender: gender };
  if (age)    body.age    = age;
  if (weight) body.weight = weight;
  if (height) body.height = height;

  var res  = await fetch('/api/admin/users/' + uid + '/metrics', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  var data = await res.json();

  if (!res.ok) {
    adminShowFeedback(uid, data.error || 'Error saving metrics.', false);
    return;
  }

  var unitLbl = unit === 'metric' ? 'kg / cm' : 'lbs / in';
  var summary = [
    age    ? 'Age: '  + age    : null,
    weight ? 'Wt: '  + weight : null,
    height ? 'Ht: '  + height : null,
    '(' + unitLbl + ')',
  ].filter(Boolean).join(' | ');
  document.getElementById('m-txt-' + uid).textContent = summary;
  document.getElementById('m-form-' + uid).style.display = 'none';
  document.getElementById('m-disp-' + uid).style.display = '';
  adminShowFeedback(uid, 'Metrics updated.', true);
}

function renderAdminWorkouts(users) {
  var tbody       = document.getElementById('admin-workouts-tbody');
  var allWorkouts = [];
  users.forEach(function (u) {
    u.workouts.forEach(function (w) {
      allWorkouts.push({
        user_name:  u.first_name + ' ' + u.last_name,
        user_email: u.email,
        id:       w.id,
        date:     w.date,
        exercise: w.exercise,
        sets:     w.sets,
        reps:     w.reps,
        weight:   w.weight,
        duration: w.duration,
      });
    });
  });

  allWorkouts.sort(function (a, b) { return b.date.localeCompare(a.date); });

  if (!allWorkouts.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-row">No workouts recorded.</td></tr>';
    return;
  }

  tbody.innerHTML = allWorkouts.map(function (w) {
    return '<tr>'
      + '<td>' + escapeHtml(w.user_name) + '<br><small style="color:var(--muted)">' + escapeHtml(w.user_email) + '</small></td>'
      + '<td>' + escapeHtml(w.date) + '</td>'
      + '<td>' + escapeHtml(w.exercise) + '</td>'
      + '<td>' + escapeHtml(w.sets) + ' &times; ' + escapeHtml(w.reps) + '</td>'
      + '<td>' + escapeHtml(w.weight) + ' lbs</td>'
      + '<td>' + (w.duration ? escapeHtml(w.duration) + ' min' : '&mdash;') + '</td>'
      + '<td>'
      + '<button class="btn-ghost admin-btn"'
        + ' data-id="'       + escapeAttr(w.id)       + '"'
        + ' data-exercise="' + escapeAttr(w.exercise)  + '"'
        + ' data-sets="'     + escapeAttr(w.sets)      + '"'
        + ' data-reps="'     + escapeAttr(w.reps)      + '"'
        + ' data-weight="'   + escapeAttr(w.weight)    + '"'
        + ' data-duration="' + escapeAttr(w.duration)  + '"'
        + ' data-date="'     + escapeAttr(w.date)      + '"'
        + ' onclick="openEditFromData(this)">Edit</button> '
      + '<button class="btn-ghost admin-btn danger"'
        + ' data-id="' + escapeAttr(w.id) + '"'
        + ' onclick="adminDeleteWorkout(this.dataset.id)">Delete</button>'
      + '</td>'
      + '</tr>';
  }).join('');
}

async function adminDeleteWorkout(id) {
  if (!confirm('Delete this workout?')) return;
  var res = await fetch('/api/admin/workouts/' + id, { method: 'DELETE' });
  if (res.ok) {
    loadAdminPanel();
  } else {
    var data = await res.json();
    alert('Error: ' + data.error);
  }
}

// ---------------------------------------------------------------------------
// Edit modal
// ---------------------------------------------------------------------------
function openEditFromData(btn) {
  var d = btn.dataset;
  openEditModal(d.id, d.exercise, d.sets, d.reps, d.weight, d.duration, d.date);
}

function openEditModal(id, exercise, sets, reps, weight, duration, date) {
  document.getElementById('modal-workout-id').value = id;
  document.getElementById('modal-exercise').value   = exercise;
  document.getElementById('modal-sets').value       = sets;
  document.getElementById('modal-reps').value       = reps;
  document.getElementById('modal-weight').value     = weight;
  document.getElementById('modal-duration').value   = duration;
  document.getElementById('modal-date').value       = date;
  hideError('modal-error');
  document.getElementById('edit-modal').classList.remove('hidden');
}

function closeEditModal() {
  document.getElementById('edit-modal').classList.add('hidden');
}

async function saveEditModal() {
  hideError('modal-error');
  var id      = document.getElementById('modal-workout-id').value;
  var payload = {
    exercise: document.getElementById('modal-exercise').value.trim(),
    sets:     parseInt(document.getElementById('modal-sets').value, 10),
    reps:     parseInt(document.getElementById('modal-reps').value, 10),
    weight:   parseFloat(document.getElementById('modal-weight').value),
    duration: parseInt(document.getElementById('modal-duration').value, 10),
    date:     document.getElementById('modal-date').value,
  };

  var res  = await fetch('/api/admin/workouts/' + id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  var data = await res.json();

  if (!res.ok) {
    showError('modal-error', data.error); return;
  }
  closeEditModal();
  loadAdminPanel();
}

// Close modal on overlay click; close exercise dropdown on outside click
document.addEventListener('click', function (e) {
  var modal = document.getElementById('edit-modal');
  if (e.target === modal) closeEditModal();

  var dropdown = document.getElementById('exercise-dropdown');
  var input    = document.getElementById('wf-exercise');
  if (dropdown && !dropdown.contains(e.target) && e.target !== input) {
    dropdown.classList.add('hidden');
  }
});

// ---------------------------------------------------------------------------
// Wger exercise search & browse
// ---------------------------------------------------------------------------
function onExerciseInput(val) {
  clearTimeout(exerciseSearchTimer);
  var dropdown = document.getElementById('exercise-dropdown');
  if (!val.trim()) {
    dropdown.classList.add('hidden');
    return;
  }
  exerciseSearchTimer = setTimeout(function () {
    searchExercises(val.trim());
  }, 300);
}

async function searchExercises(term) {
  var dropdown = document.getElementById('exercise-dropdown');
  try {
    var res      = await fetch('/api/exercises/search?term=' + encodeURIComponent(term));
    var data     = await res.json();
    var exercises = data.exercises || [];
    if (!exercises.length) {
      dropdown.classList.add('hidden');
      return;
    }
    dropdown.innerHTML = exercises.map(function (ex) {
      return '<div class="exercise-dropdown-item" data-name="' + escapeAttr(ex.name) + '"'
        + ' onclick="selectExerciseFromDropdown(this)">'
        + escapeHtml(ex.name)
        + '</div>';
    }).join('');
    dropdown.classList.remove('hidden');
  } catch (e) {
    dropdown.classList.add('hidden');
  }
}

function selectExerciseFromDropdown(el) {
  document.getElementById('wf-exercise').value = el.dataset.name;
  document.getElementById('exercise-dropdown').classList.add('hidden');
}

async function loadMuscles() {
  try {
    var res     = await fetch('/api/muscles');
    var data    = await res.json();
    var muscles = data.muscles || [];
    var sel     = document.getElementById('muscle-select');
    if (!sel) return;
    muscles.forEach(function (m) {
      var opt        = document.createElement('option');
      opt.value      = m.id;
      opt.textContent = m.name;
      sel.appendChild(opt);
    });
  } catch (e) {}
}

async function loadExercisesByMuscle(muscleId) {
  var list = document.getElementById('exercise-list');
  if (!list) return;
  if (!muscleId) { list.innerHTML = ''; return; }
  list.innerHTML = '<div style="font-size:12px;color:var(--muted)">Loading…</div>';
  try {
    var res       = await fetch('/api/exercises/by-muscle?muscle_id=' + encodeURIComponent(muscleId));
    var data      = await res.json();
    var exercises  = data.exercises || [];
    if (!exercises.length) {
      list.innerHTML = '<div style="font-size:12px;color:var(--muted)">No exercises found.</div>';
      return;
    }
    list.innerHTML = exercises.map(function (ex) {
      return '<div class="exercise-card" data-name="' + escapeAttr(ex.name) + '"'
        + ' onclick="selectExerciseCard(this)">'
        + '<div class="exercise-card-name">' + escapeHtml(ex.name) + '</div>'
        + (ex.description
            ? '<div class="exercise-card-desc">' + escapeHtml(ex.description) + '</div>'
            : '')
        + '</div>';
    }).join('');
  } catch (e) {
    list.innerHTML = '<div style="font-size:12px;color:var(--muted)">Failed to load exercises.</div>';
  }
}

function selectExerciseCard(el) {
  document.getElementById('wf-exercise').value = el.dataset.name;
}

// ---------------------------------------------------------------------------
// 2FA settings (email-based)
// ---------------------------------------------------------------------------
async function load2FAStatus() {
  var res = await fetch('/api/2fa/status');
  if (!res.ok) { twoFaEnabled = false; renderTwoFAStatus(); return; }
  var data    = await res.json();
  twoFaEnabled = !!data['2fa_enabled'];
  renderTwoFAStatus();
}

function renderTwoFAStatus() {
  var statusText = document.getElementById('twofa-status-text');
  var btn        = document.getElementById('twofa-toggle-btn');
  var success    = document.getElementById('twofa-success');
  if (success) success.style.display = 'none';

  if (twoFaEnabled) {
    statusText.textContent    = '2FA status: Enabled (email code)';
    btn.textContent           = 'Disable 2FA';
    btn.style.borderColor     = 'var(--red)';
    btn.style.color           = 'var(--red)';
  } else {
    statusText.textContent    = '2FA status: Disabled';
    btn.textContent           = 'Enable 2FA (email)';
    btn.style.borderColor     = '';
    btn.style.color           = '';
  }
}

async function toggle2FA() {
  hideError('twofa-error');
  var enable  = !twoFaEnabled;
  var url     = enable ? '/api/2fa/enroll' : '/api/2fa/disable';
  var res     = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enable: enable }),
  });
  var data = await res.json();
  if (!res.ok) {
    showError('twofa-error', data.error || 'Failed to update 2FA settings.'); return;
  }
  twoFaEnabled = data['2fa_enabled'];
  renderTwoFAStatus();
  if (twoFaEnabled) {
    var success = document.getElementById('twofa-success');
    if (success) success.style.display = 'block';
  }
}

// ---------------------------------------------------------------------------
// Health metrics helpers
// ---------------------------------------------------------------------------
function getWeightKg() {
  if (!currentUser || !currentUser.weight) return null;
  return currentUser.unit_preference === 'metric'
    ? currentUser.weight
    : currentUser.weight / 2.205;
}

function getHeightCm() {
  if (!currentUser || !currentUser.height) return null;
  return currentUser.unit_preference === 'metric'
    ? currentUser.height
    : currentUser.height * 2.54;
}

function renderHealthMetrics(workouts) {
  var prompt  = document.getElementById('health-metrics-prompt');
  var content = document.getElementById('health-metrics-content');
  if (!prompt || !content) return;

  var u = currentUser;
  if (!u || !u.age || !u.weight || !u.height) {
    prompt.classList.remove('hidden');
    content.classList.add('hidden');
    return;
  }

  prompt.classList.add('hidden');
  content.classList.remove('hidden');
  renderBMI();
  renderCaloriesChart(workouts);
  renderHRZones();
  updateBMRDisplay();
}

function renderBMI() {
  var u   = currentUser;
  var bmi;
  if (u.unit_preference === 'metric') {
    var hm = u.height / 100;
    bmi = u.weight / (hm * hm);
  } else {
    bmi = (u.weight / (u.height * u.height)) * 703;
  }
  bmi = Math.round(bmi * 10) / 10;

  document.getElementById('bmi-value').textContent = bmi;
  var badge = document.getElementById('bmi-badge');
  var label, color;
  if      (bmi < 18.5) { label = 'Underweight'; color = 'var(--blue)'; }
  else if (bmi < 25)   { label = 'Normal';       color = 'var(--green)'; }
  else if (bmi < 30)   { label = 'Overweight';   color = '#ffd740'; }
  else                 { label = 'Obese';         color = 'var(--red)'; }
  badge.textContent = label;
  badge.style.color = color;

  if (bmiChart) { bmiChart.destroy(); bmiChart = null; }
  var bmiVal = bmi;
  bmiChart = new Chart(document.getElementById('bmi-chart').getContext('2d'), {
    type: 'bar',
    data: {
      labels: ['BMI Scale'],
      datasets: [
        { label: 'Underweight (< 18.5)', data: [18.5], backgroundColor: 'rgba(79,168,255,0.55)',  stack: 'z' },
        { label: 'Normal (18.5–24.9)',   data: [6.4],  backgroundColor: 'rgba(184,249,79,0.55)', stack: 'z' },
        { label: 'Overweight (25–29.9)', data: [5],    backgroundColor: 'rgba(255,215,64,0.55)', stack: 'z' },
        { label: 'Obese (30+)',          data: [10],   backgroundColor: 'rgba(255,82,82,0.55)',  stack: 'z' },
      ],
    },
    plugins: [{
      afterDraw: function (chart) {
        var xScale = chart.scales.x;
        var yScale = chart.scales.y;
        var x   = xScale.getPixelForValue(bmiVal);
        var ctx = chart.ctx;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x, yScale.top - 4);
        ctx.lineTo(x, yScale.bottom + 4);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth   = 2;
        ctx.stroke();
        ctx.fillStyle   = '#ffffff';
        ctx.font        = 'bold 11px DM Sans';
        ctx.textAlign   = 'center';
        ctx.fillText('▲ ' + bmiVal, x, yScale.top - 8);
        ctx.restore();
      },
    }],
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { stacked: true, max: 40, ticks: { color: '#777', font: { family: 'DM Sans' } }, grid: { color: '#2a2a2a' } },
        y: { stacked: true, ticks: { display: false }, grid: { display: false } },
      },
      plugins: {
        legend: { labels: { color: '#e8e8e8', font: { family: 'DM Sans' }, boxWidth: 10, padding: 10 } },
        tooltip: { callbacks: { label: function (ctx) { return ctx.dataset.label; } } },
      },
    },
  });
}

function renderCaloriesChart(workouts) {
  var weightKg = getWeightKg();
  if (caloriesChart) { caloriesChart.destroy(); caloriesChart = null; }
  if (!weightKg) return;

  var sorted = workouts.slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
  var labels = [], cals = [];
  sorted.forEach(function (w) {
    if (w.duration > 0) {
      labels.push(w.date);
      cals.push(Math.round(5 * weightKg * (w.duration / 60)));
    }
  });

  if (!labels.length) return;

  caloriesChart = new Chart(document.getElementById('calories-chart').getContext('2d'), {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Est. Calories Burned (kcal)',
        data: cals,
        backgroundColor: 'rgba(184,249,79,0.55)',
        borderColor: '#b8f94f',
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { labels: { color: '#e8e8e8', font: { family: 'DM Sans' } } } },
      scales: {
        x: { ticks: { color: '#777', font: { family: 'DM Sans' } }, grid: { color: '#2a2a2a' } },
        y: { ticks: { color: '#777', font: { family: 'DM Sans' } }, grid: { color: '#2a2a2a' }, beginAtZero: true },
      },
    },
  });
}

function renderHRZones() {
  var age   = currentUser.age;
  var maxHR = 220 - age;
  var zones = [
    { name: 'Warm Up',  lo: 0.50, hi: 0.60, color: 'rgba(79,168,255,0.65)' },
    { name: 'Fat Burn', lo: 0.60, hi: 0.70, color: 'rgba(184,249,79,0.65)' },
    { name: 'Cardio',   lo: 0.70, hi: 0.80, color: 'rgba(255,215,64,0.65)' },
    { name: 'Peak',     lo: 0.80, hi: 0.90, color: 'rgba(255,82,82,0.65)'  },
  ];

  var tbody = document.getElementById('hr-zones-tbody');
  if (tbody) {
    tbody.innerHTML = zones.map(function (z) {
      return '<tr>'
        + '<td>' + escapeHtml(z.name) + ' Zone</td>'
        + '<td>' + Math.round(z.lo * maxHR) + ' &ndash; ' + Math.round(z.hi * maxHR) + ' BPM</td>'
        + '</tr>';
    }).join('');
  }

  if (hrChart) { hrChart.destroy(); hrChart = null; }
  hrChart = new Chart(document.getElementById('hr-chart').getContext('2d'), {
    type: 'bar',
    data: {
      labels: [''],
      datasets: zones.map(function (z) {
        return {
          label: z.name + ' Zone',
          data: [Math.round((z.hi - z.lo) * maxHR)],
          backgroundColor: z.color,
          stack: 'hr',
        };
      }),
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { stacked: true, ticks: { color: '#777', font: { family: 'DM Sans' } }, grid: { color: '#2a2a2a' } },
        y: { stacked: true, ticks: { display: false }, grid: { display: false } },
      },
      plugins: {
        legend: { labels: { color: '#e8e8e8', font: { family: 'DM Sans' }, boxWidth: 10, padding: 10 } },
        tooltip: {
          callbacks: {
            label: function (ctx) {
              var z  = zones[ctx.datasetIndex];
              return z.name + ': ' + Math.round(z.lo * maxHR) + '–' + Math.round(z.hi * maxHR) + ' BPM';
            },
          },
        },
      },
    },
  });
}

function updateBMRDisplay() {
  var u = currentUser;
  if (!u || !u.age || !u.weight || !u.height) return;

  var weightKg = getWeightKg();
  var heightCm = getHeightCm();
  var bmr = u.gender === 'female'
    ? (10 * weightKg) + (6.25 * heightCm) - (5 * u.age) - 161
    : (10 * weightKg) + (6.25 * heightCm) - (5 * u.age) + 5;

  var actEl      = document.getElementById('activity-level');
  var multiplier = actEl ? parseFloat(actEl.value) : 1.55;
  var tdee       = Math.round(bmr * multiplier);

  var caloriesEl = document.getElementById('bmr-calories');
  var macroEl    = document.getElementById('bmr-macros-text');
  if (caloriesEl) caloriesEl.textContent = tdee.toLocaleString();

  var protein = Math.round((tdee * 0.30) / 4);
  var carbs   = Math.round((tdee * 0.40) / 4);
  var fat     = Math.round((tdee * 0.30) / 9);
  if (macroEl) macroEl.textContent = 'P: ' + protein + 'g  |  C: ' + carbs + 'g  |  F: ' + fat + 'g';

  if (macroChart) { macroChart.destroy(); macroChart = null; }
  var macroCtx = document.getElementById('macro-chart');
  if (!macroCtx) return;
  macroChart = new Chart(macroCtx.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: ['Protein (' + protein + 'g)', 'Carbs (' + carbs + 'g)', 'Fat (' + fat + 'g)'],
      datasets: [{
        data: [tdee * 0.30, tdee * 0.40, tdee * 0.30],
        backgroundColor: ['rgba(184,249,79,0.7)', 'rgba(79,168,255,0.7)', 'rgba(255,215,64,0.7)'],
        borderColor:     ['#b8f94f', '#4fa8ff', '#ffd740'],
        borderWidth: 1,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { labels: { color: '#e8e8e8', font: { family: 'DM Sans' }, boxWidth: 12 } } },
    },
  });
}

// ---------------------------------------------------------------------------
// Settings panel
// ---------------------------------------------------------------------------
function loadSettings() {
  if (!currentUser) return;
  var u = currentUser;

  document.getElementById('settings-username').textContent = u.username || '—';
  document.getElementById('settings-email').textContent    = u.email    || '—';

  var createdEl = document.getElementById('settings-created');
  if (u.created_at) {
    var d = new Date(u.created_at);
    createdEl.textContent = d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  } else {
    createdEl.textContent = '—';
  }

  document.getElementById('settings-new-username').value = '';
  document.getElementById('settings-new-email').value    = '';
  document.getElementById('settings-username-msg').textContent = '';
  document.getElementById('settings-email-msg').textContent    = '';
  document.getElementById('settings-2fa-msg').textContent      = '';
  document.getElementById('settings-metrics-msg').textContent  = '';

  // Body metrics
  var unitPref = u.unit_preference || 'imperial';
  document.getElementById('unit-imperial').checked = (unitPref !== 'metric');
  document.getElementById('unit-metric').checked   = (unitPref === 'metric');
  onUnitChange();
  document.getElementById('settings-age').value    = u.age    != null ? u.age    : '';
  document.getElementById('settings-weight').value = u.weight != null ? u.weight : '';
  document.getElementById('settings-height').value = u.height != null ? u.height : '';
  document.getElementById('settings-gender').value = u.gender || '';

  updateSettings2FADisplay();
}

function onUnitChange() {
  var isMetric = document.getElementById('unit-metric').checked;
  document.getElementById('weight-label').textContent = 'Weight (' + (isMetric ? 'kg' : 'lbs') + ')';
  document.getElementById('height-label').textContent = 'Height (' + (isMetric ? 'cm' : 'inches') + ')';
}

async function saveBodyMetrics() {
  var msgEl  = document.getElementById('settings-metrics-msg');
  var age    = parseFloat(document.getElementById('settings-age').value);
  var weight = parseFloat(document.getElementById('settings-weight').value);
  var height = parseFloat(document.getElementById('settings-height').value);
  var unit   = document.querySelector('input[name="unit-pref"]:checked').value;
  var gender = document.getElementById('settings-gender').value;

  if (!age || !weight || !height || age <= 0 || weight <= 0 || height <= 0) {
    msgEl.textContent = 'Please enter valid age, weight, and height.';
    msgEl.style.color = 'var(--red)';
    return;
  }

  var res  = await fetch('/api/user/metrics', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ age: age, weight: weight, height: height, unit_preference: unit, gender: gender }),
  });
  var data = await res.json();

  if (!res.ok) {
    msgEl.textContent = data.error || 'Failed to save body metrics.';
    msgEl.style.color = 'var(--red)';
    return;
  }

  currentUser.age             = age;
  currentUser.weight          = weight;
  currentUser.height          = height;
  currentUser.unit_preference = unit;
  currentUser.gender          = gender;

  msgEl.textContent = 'Body metrics saved successfully.';
  msgEl.style.color = 'var(--green)';

  renderHealthMetrics(cachedWorkouts);
  renderWorkouts(cachedWorkouts);
}

function updateSettings2FADisplay() {
  var enabled    = currentUser && currentUser['2fa_enabled'];
  var statusEl   = document.getElementById('settings-2fa-status');
  var btn        = document.getElementById('settings-2fa-btn');
  if (statusEl) statusEl.textContent = enabled ? 'Enabled (email code)' : 'Disabled';
  if (btn) {
    btn.textContent        = enabled ? 'Disable 2FA' : 'Enable 2FA (email)';
    btn.style.borderColor  = enabled ? 'var(--red)' : '';
    btn.style.color        = enabled ? 'var(--red)' : '';
  }
}

async function saveSettingsUsername() {
  var msgEl    = document.getElementById('settings-username-msg');
  var username = document.getElementById('settings-new-username').value.trim();
  if (!username) {
    msgEl.textContent = 'Please enter a username.';
    msgEl.style.color = 'var(--red)';
    return;
  }

  var res  = await fetch('/api/user/username', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: username }),
  });
  var data = await res.json();

  if (!res.ok) {
    msgEl.textContent = data.error || 'Failed to update username.';
    msgEl.style.color = 'var(--red)';
    return;
  }

  currentUser.username = data.username;
  document.getElementById('settings-username').textContent = data.username;
  document.getElementById('settings-new-username').value   = '';
  msgEl.textContent = 'Username updated successfully.';
  msgEl.style.color = 'var(--green)';
}

async function saveSettingsEmail() {
  var msgEl = document.getElementById('settings-email-msg');
  var email = document.getElementById('settings-new-email').value.trim();
  if (!email) {
    msgEl.textContent = 'Please enter an email address.';
    msgEl.style.color = 'var(--red)';
    return;
  }

  var res  = await fetch('/api/user/email', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email }),
  });
  var data = await res.json();

  if (!res.ok) {
    msgEl.textContent = data.error || 'Failed to update email.';
    msgEl.style.color = 'var(--red)';
    return;
  }

  currentUser.email = data.email;
  document.getElementById('settings-email').textContent = data.email;
  document.getElementById('settings-new-email').value   = '';
  msgEl.textContent = 'Email updated successfully.';
  msgEl.style.color = 'var(--green)';
}

async function settingsToggle2FA() {
  var msgEl  = document.getElementById('settings-2fa-msg');
  msgEl.textContent = '';
  var enable = !(currentUser && currentUser['2fa_enabled']);
  var url    = enable ? '/api/2fa/enroll' : '/api/2fa/disable';

  var res  = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enable: enable }),
  });
  var data = await res.json();

  if (!res.ok) {
    msgEl.textContent = data.error || 'Failed to update 2FA settings.';
    msgEl.style.color = 'var(--red)';
    return;
  }

  if (currentUser) currentUser['2fa_enabled'] = data['2fa_enabled'];
  twoFaEnabled = data['2fa_enabled'];
  updateSettings2FADisplay();
  renderTwoFAStatus();
  msgEl.textContent = data['2fa_enabled'] ? '2FA enabled. You will receive a code by email each time you log in.' : '2FA disabled.';
  msgEl.style.color = data['2fa_enabled'] ? 'var(--green)' : 'var(--muted)';
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', checkAuth);
