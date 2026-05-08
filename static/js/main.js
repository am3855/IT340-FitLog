// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
var currentUser        = null;
var volumeChart        = null;
var frequencyChart     = null;
var twoFaEnabled       = false;
var exerciseSearchTimer = null;
var pending2FAEmail    = null;

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
  ['workouts', 'admin'].forEach(function (p) {
    var el = document.getElementById('panel-' + p);
    if (el) el.classList.add('hidden');
  });
  var target = document.getElementById('panel-' + name);
  if (target) target.classList.remove('hidden');

  if (name === 'admin') loadAdminPanel();
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
  renderWorkouts(workouts);
  updateStats(workouts);
  renderCharts(workouts);
}

function renderWorkouts(workouts) {
  var tbody = document.getElementById('workout-tbody');
  if (!workouts.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-row">No workouts yet. Log your first one!</td></tr>';
    return;
  }
  tbody.innerHTML = workouts.map(function (w) {
    var volume = w.sets * w.reps * w.weight;
    return '<tr>'
      + '<td>' + escapeHtml(w.date) + '</td>'
      + '<td><strong>' + escapeHtml(w.exercise) + '</strong></td>'
      + '<td>' + escapeHtml(w.sets) + ' &times; ' + escapeHtml(w.reps) + '</td>'
      + '<td>' + escapeHtml(w.weight) + ' lbs</td>'
      + '<td>' + volume.toLocaleString() + ' lbs</td>'
      + '<td>' + (w.duration ? escapeHtml(w.duration) + ' min' : '&mdash;') + '</td>'
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
    tbody.innerHTML = '<tr><td colspan="5" class="empty-row">No users found.</td></tr>';
    return;
  }
  tbody.innerHTML = users.map(function (u) {
    return '<tr>'
      + '<td>' + escapeHtml(u.first_name) + ' ' + escapeHtml(u.last_name) + '</td>'
      + '<td>' + escapeHtml(u.email) + '</td>'
      + '<td>' + (u.is_admin
        ? '<span class="badge badge-green">Admin</span>'
        : '<span class="badge badge-blue">User</span>') + '</td>'
      + '<td>' + escapeHtml(u.workouts.length) + '</td>'
      + '<td>' + (u['2fa_enabled']
        ? '<span class="badge badge-green">On</span>'
        : '<span class="badge badge-blue">Off</span>') + '</td>'
      + '</tr>';
  }).join('');
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
// Bootstrap
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', checkAuth);
