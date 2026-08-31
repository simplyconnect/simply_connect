(function () {
  'use strict';

  // =====================================================================
  // API CONFIG — point this at your deployed Google Apps Script Web App
  // (Deploy > New deployment > Web app > copy the "Web app URL").
  // =====================================================================
  var API_URL = 'https://script.google.com/macros/s/AKfycbyaiAKsUYzR31HctQjEKCjgjJvD9xnTDJ4ulTSFXdnMySxFwKPyFSJsF-VJGNwOY84/exec';

   var STORAGE_KEY = 'sc_agent_session';
  var CONFIG = null;
  var currentAgent = null;
  var selectedServices = [];
  var pendingSubmission = null; // holds payload while duplicate modal is open
  var formInitialized = false;  // guards against rebuilding the form on a second login

  // ---------------------------------------------------------------------
  // API HELPERS
  // GET requests are used for read-only calls (config/validate/history) —
  // plain GETs never trigger a CORS preflight.
  // POST requests use a text/plain Content-Type on purpose: Apps Script
  // does not handle the OPTIONS preflight that "application/json" would
  // trigger, so text/plain keeps the request a "simple request" while the
  // body is still parsed as JSON on the server (see doPost in Code.gs).
  // ---------------------------------------------------------------------
  function apiGet(action, params) {
    var url = new URL(API_URL);
    url.searchParams.set('action', action);
    Object.keys(params || {}).forEach(function (key) {
      url.searchParams.set(key, params[key]);
    });
    return fetch(url.toString(), { method: 'GET' })
      .then(function (res) {
        if (!res.ok) throw new Error('Request failed with status ' + res.status);
        return res.json();
      });
  }

  function apiPost(action, data) {
    var body = Object.assign({ action: action }, data || {});
    return fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) throw new Error('Request failed with status ' + res.status);
      return res.json();
    });
  }

  // -------------------------------------------------------------------
  // BOOTSTRAP
  // -------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('yearSpan').textContent = new Date().getFullYear();
    document.getElementById('yearSpan2').textContent = new Date().getFullYear();

    showLoading('Loading agent roster…');
    apiGet('config')
      .then(function (config) {
        CONFIG = config;
        hideLoading();
        setupLoginScreen();
        restoreSession();
      })
      .catch(function (err) {
        hideLoading();
        toast('error', 'Could not load', 'Failed to load the app configuration. Please refresh the page.');
        console.error(err);
      });
  });

  // -------------------------------------------------------------------
  // LOGIN SCREEN
  // -------------------------------------------------------------------
  function setupLoginScreen() {
    var search = document.getElementById('agentSearch');
    var dropdown = document.getElementById('agentDropdown');
    var loginBtn = document.getElementById('loginBtn');
    var selected = null;
    var activeIndex = -1;

    function renderOptions(filter) {
      var list = CONFIG.agentNames.filter(function (name) {
        return name.toLowerCase().indexOf(filter.toLowerCase()) !== -1;
      });
      dropdown.innerHTML = '';
      activeIndex = -1;

      if (list.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'agent-option-empty';
        empty.textContent = 'No matching agent found.';
        dropdown.appendChild(empty);
      } else {
        list.slice(0, 50).forEach(function (name) {
          var opt = document.createElement('div');
          opt.className = 'agent-option';
          opt.setAttribute('role', 'option');
          opt.textContent = name;
          opt.addEventListener('click', function () { selectAgent(name); });
          dropdown.appendChild(opt);
        });
      }
      dropdown.classList.remove('hidden');
    }

    function selectAgent(name) {
      selected = name;
      search.value = name;
      dropdown.classList.add('hidden');
      loginBtn.disabled = false;
    }

    search.addEventListener('input', function () {
      selected = null;
      loginBtn.disabled = true;
      if (search.value.trim().length === 0) {
        dropdown.classList.add('hidden');
        return;
      }
      renderOptions(search.value.trim());
    });

    search.addEventListener('focus', function () {
      if (search.value.trim().length > 0) renderOptions(search.value.trim());
    });

    document.addEventListener('click', function (e) {
      if (!dropdown.contains(e.target) && e.target !== search) {
        dropdown.classList.add('hidden');
      }
    });

    search.addEventListener('keydown', function (e) {
      var options = dropdown.querySelectorAll('.agent-option');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIndex = Math.min(activeIndex + 1, options.length - 1);
        highlight(options);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIndex = Math.max(activeIndex - 1, 0);
        highlight(options);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (activeIndex >= 0 && options[activeIndex]) {
          selectAgent(options[activeIndex].textContent);
        } else if (selected) {
          doLogin();
        }
      }
    });

    function highlight(options) {
      options.forEach(function (o, i) { o.classList.toggle('active', i === activeIndex); });
      if (options[activeIndex]) options[activeIndex].scrollIntoView({ block: 'nearest' });
    }

    loginBtn.addEventListener('click', doLogin);

    function doLogin() {
      if (!selected) return;
      loginBtn.disabled = true;
      loginBtn.textContent = 'Signing in…';
      showLoading('Verifying agent…');

      apiGet('validateAgent', { agent: selected })
        .then(function (result) {
          hideLoading();
          loginBtn.textContent = 'Sign In';
          if (result.valid) {
            sessionStorage.setItem(STORAGE_KEY, result.agentName);
            enterApp(result.agentName);
          } else {
            loginBtn.disabled = false;
            toast('error', 'Sign-in failed', 'That name is not on the approved agent roster.');
          }
        })
        .catch(function (err) {
          hideLoading();
          loginBtn.disabled = false;
          loginBtn.textContent = 'Sign In';
          toast('error', 'Sign-in failed', 'Something went wrong. Please try again.');
          console.error(err);
        });
    }
  }

  function restoreSession() {
    var saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved && CONFIG.agentNames.indexOf(saved) !== -1) {
      enterApp(saved);
    }
  }

  // -------------------------------------------------------------------
  // APP SHELL / FORM
  // -------------------------------------------------------------------
  function enterApp(agentName) {
    currentAgent = agentName;
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('appShell').classList.remove('hidden');
    document.getElementById('agentGreeting').textContent = 'Welcome, ' + agentName;
    document.getElementById('agentNameDisplay').value = agentName;

    if (!formInitialized) {
      // Build the dropdowns, service chips, and every event listener exactly
      // once per page load. Re-running these on a second login (e.g. after
      // logout, without a page refresh) would append duplicate <option>s and
      // duplicate chips into the same containers instead of replacing them.
      populateSelects();
      setupServiceChips();
      setupProviderFields();
      setupScreenshotUpload();
      setupFormEvents();
      setupHistoryDrawer();
      setupDuplicateModal();
      formInitialized = true;
    } else {
      // A different (or the same) agent logged back in without a page
      // refresh — clear out anything the previous session left behind.
      resetForm();
    }
  }

  function populateSelects() {
    fillSelect('campaignNumber', CONFIG.campaignNumbers, true);
    fillSelect('queueName', CONFIG.queueNames, true);
    fillSelect('team', CONFIG.teams, true);
    fillSelect('saleProcessed', CONFIG.saleProcessedOptions, true);
    fillSelect('leadGeneratedBy', CONFIG.leadGeneratedBy, false, 'N/A');
    fillSelect('currentProvider', CONFIG.currentProviders, true);
    fillSelect('state', CONFIG.usStates, true);
    fillSelect('provider', CONFIG.providers, true);
    fillSelect('rgus', CONFIG.rgus, true);
    fillSelect('installationType', CONFIG.installationTypes, false, 'N/A');
    fillSelect('closerName', CONFIG.closerNames, true);
  }

  function fillSelect(id, options, required, placeholderText) {
    var select = document.getElementById(id);
    select.innerHTML = ''; // guard against ever being called twice on the same select
    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = placeholderText || 'Select…';
    select.appendChild(placeholder);
    options.forEach(function (opt) {
      var el = document.createElement('option');
      el.value = opt;
      el.textContent = opt;
      select.appendChild(el);
    });
  }

  function setupServiceChips() {
    var group = document.getElementById('servicesGroup');
    group.innerHTML = ''; // guard against ever being called twice
    CONFIG.services.forEach(function (service) {
      var label = document.createElement('label');
      label.className = 'checkbox-chip';
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.value = service;
      var span = document.createElement('span');
      span.textContent = service;
      label.appendChild(input);
      label.appendChild(span);

      input.addEventListener('change', function () {
        label.classList.toggle('checked', input.checked);
        if (input.checked) {
          if (selectedServices.indexOf(service) === -1) selectedServices.push(service);
        } else {
          selectedServices = selectedServices.filter(function (s) { return s !== service; });
        }
      });

      group.appendChild(label);
    });
  }

  // -------------------------------------------------------------------
  // PROVIDER-SPECIFIC DETAILS (dynamic, based on Provider selected)
  // -------------------------------------------------------------------
  function setupProviderFields() {
    var providerSelect = document.getElementById('provider');
    providerSelect.addEventListener('change', function (e) {
      renderProviderFields(e.target.value);
    });
    renderProviderFields('');
  }

  function renderProviderFields(providerValue) {
    var grid = document.getElementById('providerFieldsGrid');
    var empty = document.getElementById('providerDetailsEmpty');
    grid.innerHTML = '';

    var pf = CONFIG.providerFields || { fields: [], byProvider: {} };
    var ids = pf.byProvider[providerValue] || [];

    if (!providerValue || ids.length === 0) {
      grid.classList.add('hidden');
      empty.classList.remove('hidden');
      empty.textContent = providerValue
        ? 'No additional details needed for ' + providerValue + '.'
        : 'Select a Provider above to see any additional fields for it.';
      return;
    }

    empty.classList.add('hidden');
    grid.classList.remove('hidden');

    var defsById = {};
    pf.fields.forEach(function (f) { defsById[f.id] = f; });

    ids.forEach(function (id) {
      var def = defsById[id];
      if (!def) return;

      var wrapper = document.createElement('div');
      wrapper.className = 'field';

      var label = document.createElement('label');
      label.setAttribute('for', def.id);
      label.textContent = def.label;
      wrapper.appendChild(label);

      var input;
      if (def.type === 'yesno') {
        input = document.createElement('select');
        input.className = 'input';
        ['', 'Yes', 'No'].forEach(function (opt) {
          var o = document.createElement('option');
          o.value = opt;
          o.textContent = opt === '' ? 'Select…' : opt;
          input.appendChild(o);
        });
      } else {
        input = document.createElement('input');
        input.type = def.type === 'number' ? 'number' : 'text';
        input.className = 'input';
      }
      input.id = def.id;
      input.name = def.id;
      wrapper.appendChild(input);
      grid.appendChild(wrapper);
    });
  }

  // -------------------------------------------------------------------
  // SCREENSHOT UPLOAD
  // -------------------------------------------------------------------
  function setupScreenshotUpload() {
    var fileInput = document.getElementById('screenshot');
    var preview = document.getElementById('screenshotPreview');

    fileInput.addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (!file) { clearScreenshotPreview(); return; }

      if (file.size > 8 * 1024 * 1024) {
        toast('error', 'File too large', 'Please choose an image under 8MB.');
        fileInput.value = '';
        clearScreenshotPreview();
        return;
      }

      var reader = new FileReader();
      reader.onload = function () {
        preview.classList.remove('hidden');
        preview.innerHTML = '';

        var img = document.createElement('img');
        img.src = reader.result;
        img.alt = 'Screenshot preview';

        var name = document.createElement('span');
        name.textContent = file.name;

        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', function () {
          fileInput.value = '';
          clearScreenshotPreview();
        });

        preview.appendChild(img);
        preview.appendChild(name);
        preview.appendChild(removeBtn);
      };
      reader.readAsDataURL(file);
    });
  }

  function clearScreenshotPreview() {
    var preview = document.getElementById('screenshotPreview');
    preview.classList.add('hidden');
    preview.innerHTML = '';
  }

  function readFileAsBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var base64 = String(reader.result).split(',')[1];
        resolve({ base64: base64, mimeType: file.type, fileName: file.name });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function setupFormEvents() {
    document.getElementById('logoutBtn').addEventListener('click', logout);
    document.getElementById('resetBtn').addEventListener('click', function () {
      if (confirm('Clear all fields in this form?')) resetForm();
    });
    document.getElementById('salesForm').addEventListener('submit', handleSubmit);
  }

  function logout() {
    apiPost('logout', { agentName: currentAgent }).catch(function (err) { console.error(err); });
    sessionStorage.removeItem(STORAGE_KEY);
    currentAgent = null;
    resetForm();
    document.getElementById('appShell').classList.add('hidden');
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('agentSearch').value = '';
    document.getElementById('loginBtn').disabled = true;
  }

  function resetForm() {
    document.getElementById('salesForm').reset();
    selectedServices = [];
    document.querySelectorAll('.checkbox-chip').forEach(function (chip) {
      chip.classList.remove('checked');
    });
    document.querySelectorAll('.input.invalid').forEach(function (el) {
      el.classList.remove('invalid');
    });
    renderProviderFields('');
    clearScreenshotPreview();
  }

  function collectPayload() {
    var form = document.getElementById('salesForm');
    var payload = { agentName: currentAgent, services: selectedServices };

    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name || el.type === 'checkbox' || el.type === 'file') return;
      payload[el.name] = el.value.trim();
    });
    return payload;
  }

  // -------------------------------------------------------------------
  // CLIENT-SIDE VALIDATION
  // -------------------------------------------------------------------
  var REQUIRED_IDS = [
    'campaignNumber', 'queueName', 'team', 'previousServicesCancelled',
    'saleProcessed', 'currentProvider', 'customerName', 'customerEmail',
    'phoneNumber', 'altPhoneNumber', 'customerAddress', 'state', 'zipCode',
    'workOrderNumber', 'accountNumber', 'provider', 'rgus',
    'installationDate', 'thirdPartyStreaming', 'closerName', 'salesCallType'
  ];

  function validateClientSide() {
    var invalidFields = [];

    REQUIRED_IDS.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el.value || el.value.trim() === '') {
        invalidFields.push(el);
      }
    });

    if (selectedServices.length === 0) {
      invalidFields.push(document.getElementById('servicesGroup'));
    }

    var email = document.getElementById('customerEmail');
    if (email.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)) {
      invalidFields.push(email);
    }

    ['phoneNumber', 'altPhoneNumber'].forEach(function (id) {
      var el = document.getElementById(id);
      var digits = el.value.replace(/\D/g, '');
      if (el.value && (digits.length < 10 || digits.length > 15)) {
        invalidFields.push(el);
      }
    });

    var zip = document.getElementById('zipCode');
    if (zip.value && !/^\d{5}(-\d{4})?$/.test(zip.value.trim())) {
      invalidFields.push(zip);
    }

    document.querySelectorAll('.input.invalid').forEach(function (el) { el.classList.remove('invalid'); });
    invalidFields.forEach(function (el) { el.classList.add('invalid'); });

    if (invalidFields.length > 0) {
      invalidFields[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    return invalidFields.length === 0;
  }

  // -------------------------------------------------------------------
  // SUBMIT
  // -------------------------------------------------------------------
  async function handleSubmit(e) {
    e.preventDefault();

    if (!validateClientSide()) {
      toast('error', 'Missing information', 'Please fill in every required field marked with *.');
      return;
    }

    var payload = collectPayload();

    var fileInput = document.getElementById('screenshot');
    if (fileInput.files && fileInput.files[0]) {
      try {
        var fileData = await readFileAsBase64(fileInput.files[0]);
        payload.screenshotBase64 = fileData.base64;
        payload.screenshotMimeType = fileData.mimeType;
        payload.screenshotFileName = fileData.fileName;
      } catch (err) {
        toast('info', 'Screenshot skipped', 'Could not read the selected file — submitting without it.');
      }
    }

    submitToServer(payload, false);
  }

  function submitToServer(payload, overrideDuplicate) {
    var submitBtn = document.getElementById('submitBtn');
    submitBtn.disabled = true;
    document.getElementById('submitBtnText').textContent = 'Submitting…';
    showLoading('Saving submission…');

    payload.overrideDuplicate = overrideDuplicate;

    apiPost('submit', payload)
      .then(function (result) {
        hideLoading();
        submitBtn.disabled = false;
        document.getElementById('submitBtnText').textContent = 'Submit Sale';

        if (result.success) {
          toast('success', 'Sale submitted', 'Submission ' + result.submissionId + ' saved at ' + result.timestamp + '.');
          resetForm();
        } else if (result.code === 'DUPLICATE') {
          pendingSubmission = payload;
          document.getElementById('duplicateMessage').textContent = result.message;
          document.getElementById('duplicateModal').classList.remove('hidden');
        } else if (result.code === 'UNAUTHORIZED') {
          toast('error', 'Session expired', result.message);
          logout();
        } else {
          toast('error', 'Could not submit', result.message);
        }
      })
      .catch(function (err) {
        hideLoading();
        submitBtn.disabled = false;
        document.getElementById('submitBtnText').textContent = 'Submit Sale';
        toast('error', 'Server error', 'The submission could not be saved. Please try again.');
        console.error(err);
      });
  }

  function setupDuplicateModal() {
    document.getElementById('duplicateCancelBtn').addEventListener('click', function () {
      pendingSubmission = null;
      document.getElementById('duplicateModal').classList.add('hidden');
    });
    document.getElementById('duplicateConfirmBtn').addEventListener('click', function () {
      document.getElementById('duplicateModal').classList.add('hidden');
      if (pendingSubmission) {
        submitToServer(pendingSubmission, true);
        pendingSubmission = null;
      }
    });
  }

  // -------------------------------------------------------------------
  // SUBMISSION HISTORY
  // -------------------------------------------------------------------
  var historyData = [];

  function setupHistoryDrawer() {
    document.getElementById('historyBtn').addEventListener('click', openHistory);
    document.getElementById('closeHistoryBtn').addEventListener('click', closeHistory);
    document.getElementById('historyOverlay').addEventListener('click', function (e) {
      if (e.target.id === 'historyOverlay') closeHistory();
    });
    document.getElementById('historySearch').addEventListener('input', function (e) {
      renderHistory(e.target.value.trim().toLowerCase());
    });
  }

  function openHistory() {
    document.getElementById('historyOverlay').classList.remove('hidden');
    document.getElementById('historyList').innerHTML = '<p class="empty-state">Loading your submissions…</p>';

    apiGet('history', { agent: currentAgent })
      .then(function (data) {
        historyData = data || [];
        renderHistory('');
      })
      .catch(function (err) {
        document.getElementById('historyList').innerHTML = '<p class="empty-state">Could not load submission history.</p>';
        console.error(err);
      });
  }

  function closeHistory() {
    document.getElementById('historyOverlay').classList.add('hidden');
    document.getElementById('historySearch').value = '';
  }

  function renderHistory(filter) {
    var list = document.getElementById('historyList');
    var filtered = historyData.filter(function (rec) {
      if (!filter) return true;
      var haystack = (rec.customerName + ' ' + rec.accountNumber + ' ' + rec.submissionId).toLowerCase();
      return haystack.indexOf(filter) !== -1;
    });

    if (filtered.length === 0) {
      list.innerHTML = '<p class="empty-state">No submissions found.</p>';
      return;
    }

    list.innerHTML = '';
    filtered.forEach(function (rec) {
      var item = document.createElement('div');
      item.className = 'history-item';
      item.innerHTML =
        '<div class="history-item-top">' +
          '<span class="history-item-name">' + escapeHtml(rec.customerName || 'Unknown') + '</span>' +
          '<span class="history-item-time">' + escapeHtml(rec.timestamp || '') + '</span>' +
        '</div>' +
        '<div class="history-item-meta">' +
          escapeHtml(rec.provider || '') + ' &middot; ' + escapeHtml(rec.services || '') + '<br>' +
          'Account #: ' + escapeHtml(rec.accountNumber || '—') +
        '</div>' +
        '<span class="history-item-id">' + escapeHtml(rec.submissionId || '') + '</span>' +
        (rec.screenshot ? ' <a href="' + escapeHtml(rec.screenshot) + '" target="_blank" rel="noopener" class="history-item-id" style="background:#E9F8F0;color:#1E8E5A;">View Screenshot</a>' : '');
      list.appendChild(item);
    });
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // -------------------------------------------------------------------
  // TOASTS + LOADING OVERLAY
  // -------------------------------------------------------------------
  function toast(type, title, message) {
    var container = document.getElementById('toastContainer');
    var el = document.createElement('div');
    el.className = 'toast ' + type;
    el.innerHTML = '<strong>' + escapeHtml(title) + '</strong>' + escapeHtml(message);
    container.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity 0.3s ease';
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 300);
    }, 5000);
  }

  function showLoading(text) {
    document.getElementById('loadingText').textContent = text || 'Loading…';
    document.getElementById('loadingOverlay').classList.remove('hidden');
  }

  function hideLoading() {
    document.getElementById('loadingOverlay').classList.add('hidden');
  }

})();
