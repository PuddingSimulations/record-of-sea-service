/* Cloud backend client (Supabase over plain fetch). The app stays offline-first: local storage is the working copy and this
   syncs it when signed in. Nothing here is required for the app to work. */
(function () {
  'use strict';
  var URL_ = 'https://afgjfqaocpgmihlybtkh.supabase.co', KEY = 'sb_publishable_IODM4Vb8kyvg5hozCJxsZw_KYXSzxOM';
  var SES = 'sea-cloud-session', MAP = 'sea-cloud-synced', PULL = 'sea-cloud-pulled';
  var session = null; try { session = JSON.parse(localStorage.getItem(SES) || 'null'); } catch (e) {}
  function store(k, v) { try { localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); } catch (e) {} }
  function load(k, d) { try { return JSON.parse(localStorage.getItem(k) || 'null') || d; } catch (e) { return d; } }
  function setSession(s) { session = s; if (s) store(SES, s); else try { localStorage.removeItem(SES); } catch (e) {} }

  function raw(path, opts, token) {
    opts = opts || {};
    var h = { apikey: KEY, 'Content-Type': 'application/json' }; if (token) h.Authorization = 'Bearer ' + token;
    if (opts.prefer) h.Prefer = opts.prefer;
    return fetch(URL_ + path, { method: opts.method || 'GET', headers: h, body: opts.body ? JSON.stringify(opts.body) : undefined }).then(function (r) {
      return r.text().then(function (t) {
        var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
        if (!r.ok) { var err = new Error((j && (j.msg || j.message || j.error_description || j.error)) || ('Request failed (' + r.status + ')')); err.status = r.status; throw err; }
        return j;
      });
    });
  }
  function fresh() {
    if (!session) return Promise.reject(new Error('Not signed in'));
    if (session.expires_at * 1000 - Date.now() > 60000) return Promise.resolve(session.access_token);
    return raw('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token } }).then(function (s) { keep(s); return session.access_token; },
      function (e) { if (e.status === 400 || e.status === 401) setSession(null); throw e; });
  }
  function keep(s) { setSession({ access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600), user: { id: s.user.id, email: s.user.email } }); }
  function api(path, opts) { return fresh().then(function (t) { return raw(path, opts, t); }); }
  function rpc(fn, args) { return api('/rest/v1/rpc/' + fn, { method: 'POST', body: args || {} }); }

  function auth(kind, email, pw) {
    var p = kind === 'up' ? raw('/auth/v1/signup', { method: 'POST', body: { email: email, password: pw } }) : raw('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: email, password: pw } });
    return p.then(function (s) {
      if (!s.access_token) throw new Error('Check your email to confirm your account, then sign in.');
      keep(s); return session.user;
    });
  }
  function hash(o) { var s = JSON.stringify(o), h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h); }

  // Merge local entries with the cloud. Local edits made since the last sync win; otherwise the cloud copy wins.
  // Returns the merged list and whether anything changed locally.
  function sync(entries) {
    var uid = session && session.user.id, synced = load(MAP, {}), since = localStorage.getItem(PULL) || '1970-01-01T00:00:00Z', started = new Date().toISOString();
    var local = {}; entries.forEach(function (e) { local[e.id] = e; });
    var out = [], pushes = [];
    Object.keys(local).forEach(function (id) { if (synced[id] !== hash(local[id])) pushes.push({ user_id: uid, id: id, data: local[id], deleted: false, updated_at: started }); });
    Object.keys(synced).forEach(function (id) { if (!local[id]) pushes.push({ user_id: uid, id: id, data: {}, deleted: true, updated_at: started }); });
    var dirty = {}; pushes.forEach(function (p) { dirty[p.id] = true; });
    return (pushes.length ? api('/rest/v1/entries?on_conflict=user_id,id', { method: 'POST', prefer: 'resolution=merge-duplicates', body: pushes }) : Promise.resolve())
      .then(function () { return api('/rest/v1/entries?select=id,data,deleted,updated_at&updated_at=gt.' + encodeURIComponent(since)); })
      .then(function (rows) {
        var changed = false;
        rows.forEach(function (r) {
          if (dirty[r.id]) return;
          if (r.deleted) { if (local[r.id]) { delete local[r.id]; changed = true; } }
          else if (!local[r.id] || hash(local[r.id]) !== hash(r.data)) { local[r.id] = r.data; changed = true; }
        });
        var next = {}; Object.keys(local).forEach(function (id) { next[id] = hash(local[id]); });
        store(MAP, next); store(PULL, started);
        // keep the original order for existing entries, append new ones
        var seen = {}; entries.forEach(function (e) { if (local[e.id]) { out.push(local[e.id]); seen[e.id] = 1; } });
        Object.keys(local).forEach(function (id) { if (!seen[id]) out.push(local[id]); });
        return { entries: out, changed: changed };
      });
  }

  window.Cloud = {
    configured: true,
    user: function () { return session ? session.user : null; },
    signUp: function (e, p) { return auth('up', e, p); },
    signIn: function (e, p) { return auth('in', e, p); },
    signOut: function () { setSession(null); try { localStorage.removeItem(MAP); localStorage.removeItem(PULL); localStorage.removeItem('askel-settings-marker'); localStorage.removeItem('askel-settings-dirty'); } catch (e) {} },
    sync: sync,
    saveProfile: function (name, phone) { return api('/rest/v1/profiles?on_conflict=id', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { id: session.user.id, full_name: name || '', phone: phone || null } }); },
    pushSnapshot: function (snap) { return api('/rest/v1/progress_snapshots?on_conflict=user_id', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { user_id: session.user.id, snapshot: snap, updated_at: new Date().toISOString() } }); },
    // ---- server-tracked supervisor sign-off ----
    createSign: function (entryId, snapshot) { return api('/rest/v1/sign_requests', { method: 'POST', prefer: 'return=representation', body: { user_id: session.user.id, entry_id: entryId, snapshot: snapshot } }).then(function (r) { return r[0].token; }); },
    getSign: function (t) { return raw('/rest/v1/rpc/get_sign_request', { method: 'POST', body: { t: t } }); },          // supervisor, no account
    submitSign: function (t, payload) { return raw('/rest/v1/rpc/submit_signature', { method: 'POST', body: { t: t, payload: payload } }); },
    signedRequests: function () { return api('/rest/v1/sign_requests?status=eq.signed&applied=eq.false&select=token,entry_id,signed'); },
    markApplied: function (t) { return api('/rest/v1/sign_requests?token=eq.' + encodeURIComponent(t), { method: 'PATCH', body: { applied: true } }); },
    removeCrew: function (cid, uid) { return api('/rest/v1/company_members?company_id=eq.' + cid + '&user_id=eq.' + uid, { method: 'DELETE' }); },
    getSettings: function () { return api('/rest/v1/user_settings?select=data,updated_at').then(function (r) { return r && r[0] || null; }); },
    putSettings: function (data) { return api('/rest/v1/user_settings?on_conflict=user_id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=representation', body: { user_id: session.user.id, data: data, updated_at: new Date().toISOString() } }).then(function (r) { return r && r[0] || null; }); },
    notes: function () { return api('/rest/v1/crew_notes?select=company_id,user_id,note'); },
    saveNote: function (cid, uid, note) { return api('/rest/v1/crew_notes?on_conflict=company_id,user_id', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { company_id: cid, user_id: uid, note: note, updated_at: new Date().toISOString() } }); },
    regenCode: function (cid) { return rpc('regenerate_join_code', { cid: cid }); },
    adminCompanies: function () { return rpc('admin_companies'); },
    adminSetCompany: function (cid, paidUntil, trialEnds, band, note) { return rpc('admin_set_company', { cid: cid, p_paid_until: paidUntil, p_trial_ends: trialEnds, p_band: band, p_note: note }); },
    myCompanies: function () { return rpc('my_companies'); },
    join: function (code) { return rpc('join_company', { code: code }); },
    leave: function (cid) { return api('/rest/v1/company_members?company_id=eq.' + cid + '&user_id=eq.' + session.user.id, { method: 'DELETE' }); },
    createCompany: function (name) { return rpc('create_company', { cname: name }); },
    crew: function () { return api('/rest/v1/company_crew?select=company_id,user_id,full_name,snapshot,updated_at'); }
  };
})();
