/**
 * SIMPLY CONNECT — Agent Sales Submission API
 * -------------------------------------------------
 * Google Apps Script Web App used ONLY as a JSON API. The frontend
 * (index.html / style.css / script.js) is a separate static site (e.g.
 * hosted on Vercel) that talks to this script over fetch().
 *
 * ENDPOINTS
 * ---------
 * GET  ?action=config                    -> agent roster + all dropdown options
 * GET  ?action=validateAgent&agent=NAME  -> { valid, agentName }
 * GET  ?action=history&agent=NAME        -> array of that agent's past submissions
 * POST { action: 'submit', ...fields }   -> validates, dedupes, saves the row
 * POST { action: 'logout', agentName }   -> writes a logout entry to the log
 *
 * All POST bodies are sent by the frontend as Content-Type: text/plain
 * (see script.js) — this is intentional. Apps Script Web Apps do not
 * handle the CORS preflight (OPTIONS request) that "application/json"
 * would trigger from a browser, so text/plain keeps the request a "simple
 * request" while the body is still parsed as JSON here.
 *
 * COLUMN MATCHING BY HEADER NAME
 * -------------------------------
 * Submissions are matched to sheet columns by reading the actual header
 * row (row 1) and writing each value under its matching header text — not
 * by a fixed column index. That means you (or anyone with edit access) can
 * reorder, insert, or remove columns in the Google Sheet at any time and
 * submissions will keep landing in the right place, as long as the header
 * text itself doesn't change. If you rename a header, update the matching
 * entry in the COLUMNS list below.
 *
 * SETUP
 * -----
 * 1. Open (or create) the Google Sheet that will store submissions.
 * 2. Extensions > Apps Script.
 * 3. Replace the default Code.gs content with this file. Save.
 * 4. Deploy > New deployment > Web app.
 *      - Execute as: Me
 *      - Who has access: Anyone (required so the public frontend on Vercel
 *        can reach it — Google still identifies calls by API key/agent
 *        selection is validated server-side, so this is safe for this use
 *        case; use "Anyone within [organization]" instead if all agents
 *        are on your Workspace domain and you'd rather restrict it).
 * 5. Click Deploy, authorize the requested permissions, copy the
 *    "Web app URL" — you'll paste this into script.js as API_URL.
 * 6. Whenever you edit this file: Deploy > Manage deployments > Edit >
 *    New version, so the live API picks up your changes.
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

var SHEET_NAME = 'Submissions';           // Tab that stores every submission
var LOG_SHEET_NAME = 'Login Log';         // Tab that stores agent login activity
var SCREENSHOT_FOLDER_NAME = 'Simply Connect - Sale Screenshots';
var HISTORY_LIMIT = 100;                  // Max rows returned in submission history

// All dropdown/select options, pulled from the existing Google Form.
var CONFIG = {
  "campaignNumbers": ["Group 4","Group 5","Group 10","Group 11","Group 12","Group 13","Group 18","Group 40","Group 41","Group 42","Group 43","Group 43 Chats","Group 44","Group 44 Chats","Group 45","Group 46","Group 47","Group 48","Group 48 Chats","Group 49","Group 50","Group 50 Chats","Group 51","Group 52","Group 53","Group 54","Group 55","Group 55 Chats","Group 56","Outbound","Facebook","Referral","Lead Gen","Simply Activate","Back Office","Att EDDM","Group 15","Other:"],
  "agentNames": ["Hassan Rehman","Murtaza Mehdi","Areeb Muhammad Khan","Wajahat Ali","Yousif Hyder","Taha Noor","Haider Ali","Romis Bhatti","Ahmed Jamal Khan","Safi Ahmed","Abdul Basit","Noor Us Saba","Sabrina Victoria","Zeeshan Imran","Ghazi Khan","Farhan Sheikh","Marina Kashif","Muzna Fatima","Muhammad Ashar Siddiqui","Syed Ali Raza Shah","Muhammad Asad","Sufian Rana","Saeed Usmani","Saifullah Akmal","Muhammad Ahmed Ibrahimi","Muhammad Ansar Ur Rehman","Idrees Abbasi","Ahmer Saeed Hashmi","Moses Felix","Usman Farooq","Muhammad Yaseen Khan","Muhammad Saad Raza","Shane Gill","Ahmed Tariq","Arham Abdullah","Muhammad Malhan","Saim Naqvi","Faaiz Anwar Siddiqui","Sana Solangi","Muhammad Mohsin","Chandresh Dipak","Amanullah","Izyan Imran","Hasan Tariq","Ayan Khan","Soban Ali Khan","Abdullah Ali","Mary Thomas","Imad Uddin","Muhammad Tayab Khan","Uzair Siddique","Shazil Rose","Muhammad Sahal","Kinza Rehman","Hidsa","Muhammad Ahsan","Hashwant Kumar","Muhammad Adnan","Arooj Juliana","Arron Brown","Kenneth Victor","Izhan Kamran","Alizay Kamran","Maarij Ul Haq","Moeen Khan","Taimoor Baig","Muhammad Salman Khan","Mujahid Hussain","Jalal Hussain","Ali Hunaid","Hussain Raza","Hassam Farooq","Ali Maisum","Mudassir Ali","Muneeb Alvi","Muneeb Ahmed","Muhammad Raza","Hamid Raza","Muhammad Danish","Mustafa Elahi","Saif Naeem","Khurram Rehman","Syed Arsalan Ali","Salal Baber","Rahat Khan","Muhammad Sami","Abubakar Amir","Laiba Raza"],
  "queueNames": ["Fiber Op","Fiber 2","Fiber 3","Fiber 4","Non Fiber 1","Non Fiber 2","Wireless","Backoffice (grp3)","Group Call"],
  "teams": ["Team Areeb","Team Hassan","Team Noor","Team Yousif","Team Wajahat","Team Wireless","Backoffice","Team Training"],
  "saleProcessedOptions": ["Processed Online","Call In Order","All Connect SA","All Connect ZM","Other:"],
  "leadGeneratedBy": ["Muhammad Malhan","Amanullah","Safi Ahmed","Chandresh Dipak","Shazil Rose","Sabrina Victoria","Marina Kashif","Ahmer Saeed","Abdul Hadi","Saim Naqvi","Khurram Rehman","Hashwant Kumar","Ayan Khan","Mary Thomas","Hidsa","Kinza Rehman","Hafsa Zaki","Izyan Imran","Uzair Siddique","Arham Abdullah","Muhammad Adnan","Muhammad Tayyab","Arron Brown","Kenneth Victor","Arooj Juliana","Muhammad Ahsan","Maarij Ul Haq","Soban Ali Khan","Imad Uddin","Muhammad Salman Khan","Romis Bhatti","Ali Hunaid","Mujahid Hussain","Mudassar Ali","Muhammad Danish","Mustafa Elahi","Maryaan Adnan","Syed Hasnain Haider Rizvi","Muhammad Awais Ali","Hasnain Ullah Khan","Anas Rashid","Zuhaib Ahmed","Wajeeha Shafique","Ashar Junaid","Muhammad Mustufa","Munir Usman","Muhammad Khan","Maarij Abbas Zaidi","Muhammad Sami","Syed Arsalan Ali","Salal Baber Khan","Laiba Raza"],
  "currentProviders": ["Spectrum","Xfinity","-","Cox","Optimum","At&t","Frontier","Centurylink","Brightspeed","Other:"],
  "providers": ["Xfinity","T Mobile","Frontier","Exede","Hughesnet","At&t","Earthlink","DirectTV","Windstream","Vivint","Suddenlink / Optimum / Altice","Cox","Centurylink","BrightSpeed","Verizon"],
  "services": ["TV","Internet","Phone","Home Security","Mobility"],
  "rgus": ["1","2","3","4","5","6","7","8"],
  "installationTypes": ["Mail Out","Pro Install","Store Pick Up"],
  "closerNames": ["Abdul Saboor","Hassan Rehman","Wajahat Ali","Haider Ali","Taha Noor","Areeb Muhammad Khan","Sana Solangi","Safi Ahmed Siddiqui","Sufian Rana","Muhammad Ansar Ur Rehman","Muhammad Asad","Option 12","Yousif Hyder","Romis Bhatti","Noor Us Saba","Murtaza Mehdi","Hamad Ahmed","Saifullah Akmal","Taimoor Baig","Fiza Asher","Shazil Rose","Khurram Rehman","Sabrina Victoria","Ahmed Jamal","Syed Ali Raza Shah","Ameer Abdullah","Azka Tanveer","Ahmer Saeed Hashmi","Saeed Usmani","Muneeb Alvi","Abdul Basit","Faaiz Anwar","Muhammad Saad Raza","Malahim Ahmed"],
  "usStates": ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"],

  // Provider-specific follow-up fields. `byProvider` maps a Provider dropdown
  // value to the list of extra field IDs that should appear for it; `fields`
  // defines how each of those fields renders (text / number / yesno).
  "providerFields": {
    "fields": [
      { "id": "suddenlinkInternet",        "label": "Suddenlink / Optimum / Altice (Internet)", "type": "text" },
      { "id": "tmobileInternetType",       "label": "T Mobile Internet Type",                    "type": "text" },
      { "id": "centurylinkInternet",       "label": "CenturyLink/BrightSpeed Internet",          "type": "text" },
      { "id": "centurylinkVoice",          "label": "CenturyLink/BrightSpeed Voice",             "type": "yesno" },
      { "id": "coxInternet",               "label": "Cox Internet",                              "type": "text" },
      { "id": "internetPlan",              "label": "Internet Plan",                             "type": "text" },
      { "id": "frontierInternet",          "label": "Frontier Internet",                         "type": "text" },
      { "id": "frontierVoice",             "label": "Frontier Voice",                            "type": "yesno" },
      { "id": "eeroSecure",                "label": "Eero Secure (Add On)",                      "type": "yesno" },
      { "id": "attTvDirectv",              "label": "At&t TV / Directv",                         "type": "yesno" },
      { "id": "attTvDirectvInternetRisk",  "label": "At&t TV / Directv / Internet Risk",         "type": "text" },
      { "id": "attTvDirectvPackage",       "label": "At&t TV / Directv Package",                 "type": "text" },
      { "id": "attInternet",               "label": "At&t Internet",                             "type": "text" },
      { "id": "accAccount",                "label": "ACC Account",                               "type": "text" },
      { "id": "attMobilityLines",          "label": "At&t Mobility Number of Lines",             "type": "number" },
      { "id": "xfinityInternet",           "label": "Xfinity Internet",                          "type": "text" },
      { "id": "xfinityTv",                 "label": "Xfinity TV",                                "type": "yesno" },
      { "id": "windstreamInternet",        "label": "Windstream Internet",                       "type": "text" },
      { "id": "earthlinkPackageDetails",   "label": "Earthlink Package Details",                 "type": "text" },
      { "id": "earthlinkInternetSpeed",    "label": "Earthlink Internet Speed",                  "type": "text" }
    ],
    "byProvider": {
      "Suddenlink / Optimum / Altice": ["suddenlinkInternet"],
      "T Mobile": ["tmobileInternetType"],
      "Centurylink": ["centurylinkInternet", "centurylinkVoice"],
      "BrightSpeed": ["centurylinkInternet", "centurylinkVoice"],
      "Cox": ["coxInternet", "internetPlan", "eeroSecure"],
      "Frontier": ["frontierInternet", "frontierVoice"],
      "At&t": ["attTvDirectv", "attTvDirectvInternetRisk", "attTvDirectvPackage", "attInternet", "accAccount", "attMobilityLines"],
      "Xfinity": ["xfinityInternet", "xfinityTv", "eeroSecure"],
      "Windstream": ["windstreamInternet"],
      "Earthlink": ["earthlinkPackageDetails", "earthlinkInternetSpeed"]
    }
  }
};

// Default column schema: field ID -> sheet header text. Used (a) to create
// the Submissions sheet with the right headers the first time it runs, and
// (b) as the lookup table for "which header does this field belong under".
// Actual reads/writes always resolve the LIVE column position by header
// name (see getHeaderMap_) — so reordering columns in the sheet is safe.
var COLUMNS = [
  { id: 'date',                      header: 'Date' },
  { id: 'timestamp',                 header: 'Timestamp' },
  { id: 'campaignNumber',            header: 'gRPCampaign Number' },
  { id: 'agentName',                 header: 'Agent Name' },
  { id: 'queueName',                 header: 'Call Received from Queue Name' },
  { id: 'team',                      header: 'Team' },
  { id: 'previousServicesCancelled', header: 'Previous Services Cancelled (If NO then provider reason in comments)' },
  { id: 'saleProcessed',             header: 'Sale Processed' },
  { id: 'leadGeneratedBy',           header: 'Lead Generated by (If Any)' },
  { id: 'currentProvider',           header: 'Current Provider' },
  { id: 'customerName',              header: 'Customer Name' },
  { id: 'customerEmail',             header: 'Customer E-mail' },
  { id: 'phoneNumber',               header: 'Phone number' },
  { id: 'altPhoneNumber',            header: 'Alternate phone number' },
  { id: 'customerAddress',           header: 'Customer Address' },
  { id: 'state',                     header: 'State' },
  { id: 'zipCode',                   header: 'Zip code' },
  { id: 'ocn',                       header: 'Order Confirmation Number (OCN)' },
  { id: 'workOrderNumber',           header: 'Work Order Number' },
  { id: 'accountNumber',             header: 'Account Number' },
  { id: 'provider',                  header: 'Provider' },
  { id: 'services',                  header: 'Services' },
  { id: 'rgus',                      header: "RGU's" },
  { id: 'installationType',          header: 'Installation Type' },
  { id: 'installationDate',          header: 'Installation Date' },
  { id: 'comments',                  header: 'Comments' },
  { id: 'thirdPartyStreaming',       header: 'Any Third Party Streaming Services Sold' },
  { id: 'closerName',                header: 'Closer Name' },
  { id: 'installationTime',          header: 'Installation Time' },
  { id: 'accountPin',                header: 'Account Pin' },
  { id: 'accountSecurityQuestion',   header: 'Account Security Question' },
  { id: 'salesCallType',             header: 'Sales Call/Non Sales Call' },
  { id: 'screenshot',                header: 'Screenshot' },
  { id: 'suddenlinkInternet',        header: 'Suddenlink / Optimum / Altice (Internet)' },
  { id: 'tmobileInternetType',       header: 'T Mobile Internet type' },
  { id: 'centurylinkInternet',       header: 'CenturyLink/BrightSpeed Internet' },
  { id: 'centurylinkVoice',          header: 'Century Link/BrightSpeed Voice' },
  { id: 'coxInternet',               header: 'Cox Internet' },
  { id: 'internetPlan',              header: 'Internet Plan' },
  { id: 'frontierInternet',          header: 'Frontier Internet' },
  { id: 'frontierVoice',             header: 'Frontier Voice' },
  { id: 'eeroSecure',                header: 'Eero Secure (Add On)' },
  { id: 'attTvDirectv',              header: 'At&t TV / Directv' },
  { id: 'attTvDirectvInternetRisk',  header: 'At&t TV / Directv / Internet Risk' },
  { id: 'attTvDirectvPackage',       header: 'At&t TV / Directv Package' },
  { id: 'attInternet',               header: 'At&t Internet' },
  { id: 'accAccount',                header: 'ACC Account' },
  { id: 'attMobilityLines',          header: 'At&t Mobility Number of Lines' },
  { id: 'xfinityInternet',           header: 'Xfinity Internet' },
  { id: 'xfinityTv',                 header: 'Xfinity TV' },
  { id: 'windstreamInternet',        header: 'Windstream Internet' },
  { id: 'earthlinkPackageDetails',   header: 'Earthlink Package Details' },
  { id: 'earthlinkInternetSpeed',    header: 'Earthlink Internet Speed' }
];

// Fields that are required (mirrors the asterisk fields in the source form).
// Provider-specific follow-up fields (Xfinity Internet, At&t TV / Directv,
// etc.) are intentionally optional since they only apply to some providers.
var REQUIRED_FIELDS = [
  'campaignNumber', 'queueName', 'team', 'previousServicesCancelled',
  'saleProcessed', 'currentProvider', 'customerName', 'customerEmail',
  'phoneNumber', 'altPhoneNumber', 'customerAddress', 'state', 'zipCode',
  'workOrderNumber', 'accountNumber', 'provider', 'services', 'rgus',
  'installationDate', 'thirdPartyStreaming', 'closerName', 'salesCallType'
];

// ============================================================================
// WEB APP ENTRY POINTS (JSON API only — no HTML is served from here)
// ============================================================================

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';

  try {
    if (action === 'config') {
      return jsonOutput_(CONFIG);
    }
    if (action === 'validateAgent') {
      return jsonOutput_(validateAgent(e.parameter.agent));
    }
    if (action === 'history') {
      return jsonOutput_(getSubmissionHistory(e.parameter.agent));
    }
    return jsonOutput_({ status: 'ok', message: 'Simply Connect Agent Sales API is running.' });
  } catch (err) {
    return jsonOutput_({ success: false, code: 'SERVER_ERROR', message: err.message });
  }
}

function doPost(e) {
  try {
    var body = {};
    if (e && e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    }
    var action = body.action || '';

    if (action === 'submit') {
      return jsonOutput_(submitSale(body));
    }
    if (action === 'logout') {
      return jsonOutput_(recordLogout(body.agentName));
    }
    return jsonOutput_({ success: false, code: 'UNKNOWN_ACTION', message: 'Unknown action: ' + action });
  } catch (err) {
    return jsonOutput_({ success: false, code: 'SERVER_ERROR', message: err.message });
  }
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================================
// SHEET HELPERS
// ============================================================================

function getSpreadsheet_() {
  // Bound-script default. If you deploy this as a standalone script instead,
  // replace the line below with:
  //   return SpreadsheetApp.openById('YOUR_SPREADSHEET_ID');
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getOrCreateSheet_(name, headers) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    var headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setFontWeight('bold')
      .setBackground('#2b2b2e')
      .setFontColor('#ffffff');
    sheet.autoResizeColumns(1, headers.length);
  }
  return sheet;
}

function getSubmissionsSheet_() {
  var headers = COLUMNS.map(function (c) { return c.header; });
  return getOrCreateSheet_(SHEET_NAME, headers);
}

function getLogSheet_() {
  return getOrCreateSheet_(LOG_SHEET_NAME, ['Timestamp', 'Agent Name', 'Event']);
}

function getScreenshotFolder_() {
  var folders = DriveApp.getFoldersByName(SCREENSHOT_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(SCREENSHOT_FOLDER_NAME);
}

/**
 * Reads the sheet's actual header row (row 1) and returns a map of
 * { headerText: columnIndex } (0-based). This is the core of the
 * "match by header name, not fixed position" requirement — every read
 * and write below goes through this instead of assuming COLUMNS order
 * matches physical column order.
 */
function getHeaderMap_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) return {};
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var map = {};
  headers.forEach(function (h, i) {
    var key = String(h || '').trim();
    if (key) map[key] = i;
  });
  return map;
}

/**
 * Builds one sheet row (array, in the CURRENT physical column order) from
 * a { headerText: value } object. Any header in the sheet that isn't in
 * valuesByHeader is left blank; any header the sheet doesn't have is
 * simply not written (so it's safe to add/remove sheet columns too).
 */
function buildRowFromHeaders_(sheet, valuesByHeader) {
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  return headers.map(function (h) {
    var key = String(h || '').trim();
    return valuesByHeader.hasOwnProperty(key) ? valuesByHeader[key] : '';
  });
}

// ============================================================================
// PUBLIC API — called from the frontend via fetch (doGet / doPost above)
// ============================================================================

/**
 * Validates that a name selected on the login screen is a real, authorized
 * agent (never trust the client to self-report who they are).
 */
function validateAgent(agentName) {
  var name = String(agentName || '').trim();
  var found = CONFIG.agentNames.indexOf(name) !== -1;
  if (found) {
    logEvent_(name, 'Login');
  }
  return { valid: found, agentName: name };
}

function recordLogout(agentName) {
  logEvent_(agentName, 'Logout');
  return { ok: true };
}

function logEvent_(agentName, event) {
  try {
    var sheet = getLogSheet_();
    sheet.appendRow([new Date(), agentName, event]);
  } catch (err) {
    // Logging must never block login/logout.
  }
}

/**
 * Uploads a base64-encoded screenshot to Drive and returns its shareable URL.
 * Never throws — a failed screenshot upload should not block a sale from
 * being saved.
 */
function saveScreenshot_(base64Data, mimeType, fileName, tag) {
  if (!base64Data) return '';
  try {
    var bytes = Utilities.base64Decode(base64Data);
    var safeName = (fileName || (tag + '.png')).replace(/[\\\/:*?"<>|]/g, '_');
    var blob = Utilities.newBlob(bytes, mimeType || 'image/png', tag + ' - ' + safeName);
    var folder = getScreenshotFolder_();
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return file.getUrl();
  } catch (err) {
    return '';
  }
}

/**
 * Main submission handler. Validates required fields, checks for duplicates,
 * writes the row (matched to sheet columns by HEADER NAME, not position),
 * uploads any attached screenshot, and returns a structured result the
 * client can use for success/error alerts.
 */
function submitSale(payload) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    payload = payload || {};

    // --- Authorization -----------------------------------------------------
    var agentName = String(payload.agentName || '').trim();
    if (CONFIG.agentNames.indexOf(agentName) === -1) {
      return { success: false, code: 'UNAUTHORIZED', message: 'Your session is invalid. Please log in again.' };
    }

    // --- Validation ----------------------------------------------------------
    var errors = validatePayload_(payload);
    if (errors.length > 0) {
      return { success: false, code: 'VALIDATION', message: errors.join(' '), fields: errors };
    }

    // --- Duplicate prevention ------------------------------------------------
    var dup = findDuplicate_(payload);
    if (dup && !payload.overrideDuplicate) {
      return {
        success: false,
        code: 'DUPLICATE',
        message: 'A submission with this phone number and account number already exists ' +
          '(submitted by ' + dup.agentName + ' on ' + dup.timestamp + '). ' +
          'If this is intentional, resubmit to confirm.',
        duplicate: dup
      };
    }

    // --- Screenshot upload (optional) -----------------------------------
    var timestamp = new Date();
    var tz = Session.getScriptTimeZone() || 'America/Chicago';
    var tag = 'SC-' + Utilities.formatDate(timestamp, tz, 'yyMMddHHmmss');
    var screenshotUrl = payload.screenshotBase64
      ? saveScreenshot_(payload.screenshotBase64, payload.screenshotMimeType, payload.screenshotFileName, tag)
      : '';

    // --- Build { headerText: value } and write by header name -----------
    var sheet = getSubmissionsSheet_();
    var valuesByHeader = {};

    COLUMNS.forEach(function (col) {
      var value;
      if (col.id === 'date') value = Utilities.formatDate(timestamp, tz, 'MM/dd/yyyy');
      else if (col.id === 'timestamp') value = timestamp;
      else if (col.id === 'agentName') value = agentName;
      else if (col.id === 'screenshot') value = screenshotUrl;
      else if (col.id === 'services') value = Array.isArray(payload.services) ? payload.services.join(', ') : (payload.services || '');
      else value = payload[col.id] != null ? payload[col.id] : '';

      valuesByHeader[col.header] = value;
    });

    sheet.appendRow(buildRowFromHeaders_(sheet, valuesByHeader));

    return {
      success: true,
      message: 'Sale submitted successfully.',
      submissionId: tag,
      timestamp: Utilities.formatDate(timestamp, tz, 'MMM d, yyyy h:mm a')
    };
  } catch (err) {
    return { success: false, code: 'SERVER_ERROR', message: 'Something went wrong while saving: ' + err.message };
  } finally {
    lock.releaseLock();
  }
}

function validatePayload_(payload) {
  var errors = [];

  REQUIRED_FIELDS.forEach(function (field) {
    var val = payload[field];
    var empty = (val === undefined || val === null || val === '' ||
      (Array.isArray(val) && val.length === 0));
    if (empty) {
      errors.push(fieldLabel_(field) + ' is required.');
    }
  });

  if (payload.customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.customerEmail)) {
    errors.push('Customer e-mail address is not valid.');
  }

  ['phoneNumber', 'altPhoneNumber'].forEach(function (field) {
    if (payload[field]) {
      var digits = String(payload[field]).replace(/\D/g, '');
      if (digits.length < 10 || digits.length > 15) {
        errors.push(fieldLabel_(field) + ' must be a valid phone number.');
      }
    }
  });

  if (payload.zipCode && !/^\d{5}(-\d{4})?$/.test(String(payload.zipCode).trim())) {
    errors.push('Zip code must be a valid 5-digit (or ZIP+4) code.');
  }

  if (payload.installationDate && isNaN(Date.parse(payload.installationDate))) {
    errors.push('Installation date is not valid.');
  }

  return errors;
}

function fieldLabel_(id) {
  var match = COLUMNS.filter(function (c) { return c.id === id; })[0];
  return match ? match.header : id;
}

/**
 * Looks for an existing submission with the same phone number AND account
 * number. Columns are located by HEADER NAME via getHeaderMap_, so this
 * still works even if the sheet's columns have been reordered.
 */
function findDuplicate_(payload) {
  var phone = normalizePhone_(payload.phoneNumber);
  var account = String(payload.accountNumber || '').trim().toLowerCase();
  if (!phone || !account) return null;

  var sheet = getSubmissionsSheet_();
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2) return null;

  var headerMap = getHeaderMap_(sheet);
  var phoneCol = headerMap[fieldLabel_('phoneNumber')];
  var accountCol = headerMap[fieldLabel_('accountNumber')];
  var timestampCol = headerMap[fieldLabel_('timestamp')];
  var agentCol = headerMap[fieldLabel_('agentName')];
  if (phoneCol === undefined || accountCol === undefined) return null;

  var tz = Session.getScriptTimeZone() || 'America/Chicago';
  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  for (var i = 0; i < data.length; i++) {
    var rowPhone = normalizePhone_(data[i][phoneCol]);
    var rowAccount = String(data[i][accountCol] || '').trim().toLowerCase();
    if (rowPhone === phone && rowAccount === account) {
      var rawTs = timestampCol !== undefined ? data[i][timestampCol] : null;
      return {
        agentName: agentCol !== undefined ? data[i][agentCol] : '',
        timestamp: rawTs ? Utilities.formatDate(new Date(rawTs), tz, 'MMM d, yyyy h:mm a') : ''
      };
    }
  }
  return null;
}

function normalizePhone_(val) {
  return String(val || '').replace(/\D/g, '');
}

/**
 * Returns the most recent submissions for a given agent (for the
 * "Submission History" panel). A display-only reference ID is derived from
 * each row's Timestamp — there is no separate Submission ID column in the
 * sheet, by design. Columns are located by header name, so this works
 * regardless of column order.
 */
function getSubmissionHistory(agentName) {
  var sheet = getSubmissionsSheet_();
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || !agentName) return [];

  var headerMap = getHeaderMap_(sheet);
  var agentCol = headerMap[fieldLabel_('agentName')];
  if (agentCol === undefined) return [];

  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  var results = [];
  for (var i = data.length - 1; i >= 0 && results.length < HISTORY_LIMIT; i--) {
    if (String(data[i][agentCol]) === String(agentName)) {
      results.push(rowToRecord_(data[i], headers));
    }
  }
  return results;
}

/**
 * Converts one sheet row into a { fieldId: value } record for the frontend,
 * using the live header row to know which physical column holds which
 * field — NOT the COLUMNS array's order.
 */
function rowToRecord_(row, headers) {
  var tz = Session.getScriptTimeZone() || 'America/Chicago';
  var headerToId = {};
  COLUMNS.forEach(function (col) { headerToId[col.header] = col.id; });

  var record = {};
  var rawTimestampVal = null;

  headers.forEach(function (h, idx) {
    var id = headerToId[String(h || '').trim()];
    if (!id) return; // unrecognized/custom column — skip
    var val = row[idx];
    if (id === 'timestamp') {
      rawTimestampVal = val;
      if (val instanceof Date) {
        val = Utilities.formatDate(val, tz, 'MMM d, yyyy h:mm a');
      }
    }
    record[id] = val;
  });

  var d = (rawTimestampVal instanceof Date) ? rawTimestampVal : new Date(rawTimestampVal);
  record.submissionId = !isNaN(d.getTime())
    ? 'SC-' + Utilities.formatDate(d, tz, 'yyMMddHHmmss')
    : 'SC-UNKNOWN';

  return record;
}
