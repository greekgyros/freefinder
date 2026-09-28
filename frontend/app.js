const config = TIMETABLE;

let me = null;          // signed-in account: { name, code, free, following, viewers }
let newName = null;     // name typed by someone making a new account (not saved yet)
let selected = null;    // Set of slot keys ("A-Mon-L") being edited
let setupWeek = 'A';
let tab = 'calendar';   // 'calendar' | 'account'
let calWeek = 'A';
let hidden = new Set(); // friend ids switched off in the calendar
let onlyMine = false;   // calendar: only show times I'm free too
let confirmingDelete = false;
let renderCount = 0;    // bumps on every home render; lets background refreshes see they're stale

// Friend colours in the calendar, assigned in list order.
const COLORS = ['#3a5a40', '#2e5aac', '#b5651d', '#7b4b94', '#a83a3a', '#1f7a8c', '#8a6d1a', '#c2185b'];

const app = document.getElementById('app');

function esc(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function codeHtml(code, cls = ''){
  return `<div class="code ${cls}"><span class="slashes">///</span>${esc(code)}</div>`;
}

function setStatus(id, text, isError = false){
  const el = document.getElementById(id);
  if(!el) return;
  el.textContent = text;
  el.classList.toggle('error', isError);
}

async function copyText(text, statusId){
  try{
    await navigator.clipboard.writeText(text);
    setStatus(statusId, 'Copied.');
  }catch(e){
    setStatus(statusId, 'Copy failed - select the code and copy it by hand.', true);
  }
}

function signIn(account){
  api.code = account.code;
  me = account;
  newName = null;
  tab = 'calendar';
  hidden = new Set();
  confirmingDelete = false;
}

// Replace the signed-in account with fresh data from the backend (code isn't echoed back).
function setMe(account){
  me = { ...account, code: me.code };
}

// Run an account action, re-render, then show a status message in `statusId`.
async function act(promise, statusId, doneText){
  try{
    const res = await promise;
    setMe(res.account);
    renderHome();
    if(doneText) setStatus(statusId, doneText);
  }catch(e){
    setStatus(statusId, e.message, true);
  }
}

// ---- Name / code entry ---------------------------------------------------

function renderNameEntry(message = ''){
  app.innerHTML = `
    <div class="card">
      <label for="nameInput">Your name or secret code</label>
      <input type="text" id="nameInput" placeholder="e.g. Allegra" autocomplete="off" autocapitalize="off" spellcheck="false">
      <p class="hint">New here? Enter your name. Been here before? Enter your three-word code (like <i>apple.river.stone</i>) to get your saved frees back.</p>
      <button id="continueBtn">Continue</button>
      <div class="status" id="statusMsg">${esc(message)}</div>
    </div>
  `;
  const input = document.getElementById('nameInput');
  const btn = document.getElementById('continueBtn');
  input.focus();
  input.addEventListener('keydown', e => { if(e.key === 'Enter') btn.click(); });

  btn.onclick = async () => {
    const val = input.value.trim();
    if(!val){
      setStatus('statusMsg', 'Enter your name or code first.', true);
      return;
    }
    btn.disabled = true;
    setStatus('statusMsg', 'Loading...');
    try{
      const res = await api.login(val);
      if(res.account){
        signIn(res.account);
        renderHome();
      }else{
        newName = res.name;
        selected = new Set();
        setupWeek = config.weeks[0];
        renderSetup();
      }
    }catch(e){
      setStatus('statusMsg', e.message, true);
      btn.disabled = false;
    }
  };
}

// ---- Free-period grid (editing your own frees) ----------------------------

function isExtra(slot){
  return slot.id === 'L' || slot.id === 'AS';
}

function renderSetup(){
  const name = me ? me.name : newName;
  let rows = '';
  config.slots.forEach(slot => {
    let cells = `<td><b>${esc(slot.label)}</b></td>`;
    config.days.forEach(day => {
      const k = setupWeek + '-' + day + '-' + slot.id;
      cells += `<td><span class="cell ${selected.has(k) ? 'on' : ''}" data-key="${k}"></span></td>`;
    });
    rows += `<tr class="${isExtra(slot) ? 'extra' : ''}">${cells}</tr>`;
  });

  app.innerHTML = `
    <div class="card">
      <p class="who-you">Hi <b>${esc(name)}</b> — tap every period you're free for both weeks of your timetable, plus the lunchtimes and after-school slots you're around for.</p>
      <div class="row" style="margin-top:0;margin-bottom:16px;">
        ${config.weeks.map(w => `<button class="${w === setupWeek ? '' : 'secondary'}" data-week="${w}">Week ${w}</button>`).join('')}
      </div>
      <table class="grid">
        <thead><tr><th></th>${config.days.map(d => `<th>${d}</th>`).join('')}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="row">
        <button id="saveBtn">${me ? 'Save my frees' : 'Save and get my code'}</button>
        <button class="secondary" id="cancelBtn">${me ? 'Cancel' : 'Back'}</button>
      </div>
      <div class="status" id="statusMsg2"></div>
    </div>
  `;

  document.querySelectorAll('[data-week]').forEach(btn => {
    btn.onclick = () => { setupWeek = btn.dataset.week; renderSetup(); };
  });

  document.querySelectorAll('.cell').forEach(cell => {
    cell.onclick = () => {
      const k = cell.dataset.key;
      if(selected.has(k)) selected.delete(k); else selected.add(k);
      cell.classList.toggle('on');
    };
  });

  document.getElementById('cancelBtn').onclick = () => {
    if(me) renderHome(); else renderNameEntry();
  };

  document.getElementById('saveBtn').onclick = async () => {
    const btn = document.getElementById('saveBtn');
    btn.disabled = true;
    setStatus('statusMsg2', 'Saving...');
    try{
      if(me){
        const res = await api.saveFree([...selected]);
        setMe(res.account);
        renderHome();
      }else{
        const res = await api.createAccount(newName, [...selected]);
        signIn(res.account);
        renderNewCode();
      }
    }catch(e){
      setStatus('statusMsg2', e.message, true);
      btn.disabled = false;
    }
  };
}

// ---- Shown once, right after an account is made -----------------------------

function renderNewCode(){
  app.innerHTML = `
    <div class="card">
      <h2>Your secret code</h2>
      ${codeHtml(me.code)}
      <p class="who-you">This is how you sign in next time — type it into the name box to get your saved frees back.</p>
      <p class="who-you">It's also how friends find you. When someone enters your code you'll get a request under <b>My account</b>, and <b>they can only see your frees once you approve them.</b></p>
      <p class="warn-note">Write it down or copy it somewhere safe. There's no way to recover it if you lose it.</p>
      <div class="row">
        <button id="copyBtn" class="secondary">Copy code</button>
        <button id="doneBtn">I've saved it</button>
      </div>
      <div class="status" id="statusMsg3"></div>
    </div>
  `;
  document.getElementById('copyBtn').onclick = () => copyText(me.code, 'statusMsg3');
  document.getElementById('doneBtn').onclick = renderHome;
}

// ---- Signed-in home: header, tabs, and the current tab ------------------------

function renderHome(){
  renderCount++;
  const requests = me.viewers.filter(v => v.status === 'pending').length;
  app.innerHTML = `
    <p class="who-you">Signed in as <b>${esc(me.name)}</b> · <button class="link" id="signOutLink">sign out</button></p>
    <div class="tabs">
      <button class="tab ${tab === 'calendar' ? 'active' : ''}" data-tab="calendar">Calendar</button>
      <button class="tab ${tab === 'account' ? 'active' : ''}" data-tab="account">My account${requests ? ` <span class="badge">${requests}</span>` : ''}</button>
    </div>
    <div id="tabBody"></div>
  `;
  document.getElementById('signOutLink').onclick = () => {
    me = null;
    api.code = null;
    renderNameEntry();
  };
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.onclick = () => switchTab(btn.dataset.tab);
  });
  if(tab === 'calendar') renderCalendar(); else renderAccount();
}

// Switching tabs also pulls fresh data, so new requests and approvals show up.
async function switchTab(next){
  tab = next;
  confirmingDelete = false;
  renderHome();
  const seen = renderCount;
  try{
    const res = await api.getAccount();
    // Don't clobber anything the person has done or started typing meanwhile.
    const draft = document.getElementById('friendCode');
    if(!me || renderCount !== seen || (draft && draft.value)) return;
    if(JSON.stringify(res.account) === JSON.stringify({ ...me, code: undefined })) return;
    setMe(res.account);
    renderHome();
  }catch(e){
    // keep showing what we have
  }
}

// ---- Calendar: every approved friend's frees at once -------------------------

function renderCalendar(){
  const body = document.getElementById('tabBody');
  const approved = me.following.filter(f => f.status === 'approved');
  const pending = me.following.filter(f => f.status === 'pending');
  const colorOf = {};
  approved.forEach((f, i) => { colorOf[f.id] = COLORS[i % COLORS.length]; });
  const shown = approved.filter(f => !hidden.has(f.id));
  const mine = new Set(me.free);

  const pendingNote = pending.length
    ? `<p class="hint" style="margin:12px 0 0">Waiting for approval from ${pending.map(f => `<b>${esc(f.name)}</b>`).join(', ')}.</p>`
    : '';

  if(!approved.length){
    body.innerHTML = `
      <div class="card">
        <p class="empty">No friends' frees to show yet. Add a friend's code under My account — once they approve you, their frees appear here.</p>
        ${pendingNote}
        <div class="row"><button id="goAccount">Add a friend</button></div>
      </div>`;
    document.getElementById('goAccount').onclick = async () => {
      await switchTab('account');
      const input = document.getElementById('friendCode');
      if(input) input.focus();
    };
    return;
  }

  let rows = '';
  config.slots.forEach(slot => {
    let cells = `<th scope="row">${esc(slot.label)}</th>`;
    config.days.forEach(day => {
      const k = calWeek + '-' + day + '-' + slot.id;
      const iAmFree = mine.has(k);
      const who = (onlyMine && !iAmFree) ? [] : shown.filter(f => f.free.includes(k));
      const pills = who.map(f =>
        `<span class="cal-pill" style="--c:${colorOf[f.id]}" title="${esc(f.name)}">${esc(f.name.split(' ')[0])}</span>`
      ).join('');
      cells += `<td class="${iAmFree ? 'mine' : ''}">${pills}</td>`;
    });
    rows += `<tr class="${isExtra(slot) ? 'extra' : ''}">${cells}</tr>`;
  });

  body.innerHTML = `
    <div class="card">
      <div class="row" style="margin-top:0">
        ${config.weeks.map(w => `<button class="${w === calWeek ? '' : 'secondary'}" data-calweek="${w}">Week ${w}</button>`).join('')}
      </div>
      <div class="legend">
        ${approved.map(f => `<button class="chip ${hidden.has(f.id) ? 'off' : ''}" data-friend="${esc(f.id)}" style="--c:${colorOf[f.id]}" title="Show/hide">${esc(f.name)}</button>`).join('')}
      </div>
      <label class="check"><input type="checkbox" id="onlyMine" ${onlyMine ? 'checked' : ''}> Only show times I'm free too</label>
      <div class="cal-scroll">
        <table class="cal">
          <thead><tr><th></th>${config.days.map(d => `<th scope="col">${d}</th>`).join('')}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="hint" style="margin:10px 0 0"><span class="swatch"></span> Shaded = you're free too. Tap a name above to hide or show them.</p>
      ${pendingNote}
    </div>
  `;

  document.querySelectorAll('[data-calweek]').forEach(btn => {
    btn.onclick = () => { calWeek = btn.dataset.calweek; renderCalendar(); };
  });
  document.querySelectorAll('[data-friend]').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.friend;
      if(hidden.has(id)) hidden.delete(id); else hidden.add(id);
      renderCalendar();
    };
  });
  document.getElementById('onlyMine').onchange = e => { onlyMine = e.target.checked; renderCalendar(); };
}

// ---- Account manager ---------------------------------------------------------

function personRow(name, tag, actions){
  return `<div class="person"><span class="person-name">${esc(name)}${tag ? ` <span class="tag">${tag}</span>` : ''}</span><span class="person-actions">${actions}</span></div>`;
}

function renderAccount(){
  const body = document.getElementById('tabBody');
  const requests = me.viewers.filter(v => v.status === 'pending');
  const viewers = me.viewers.filter(v => v.status === 'approved');

  body.innerHTML = `
    <div class="card">
      <h2>Your code</h2>
      <p class="who-you">Give this to friends so they can ask to see your frees. Use it to sign in next time.</p>
      <div id="myCode">${codeHtml(me.code, 'small hidden')}</div>
      <div class="row">
        <button class="secondary small" id="showCodeBtn">Show</button>
        <button class="secondary small" id="copyCodeBtn">Copy</button>
      </div>
      <div class="status" id="codeStatus"></div>
    </div>

    <div class="card">
      <h2>Requests to see your frees</h2>
      ${requests.length
        ? requests.map(v => personRow(v.name, '', `
            <button class="small" data-approve="${esc(v.id)}">Approve</button>
            <button class="secondary small" data-decline="${esc(v.id)}">Decline</button>`)).join('')
        : '<p class="empty">No requests right now.</p>'}
      <div class="status" id="requestStatus"></div>
    </div>

    <div class="card">
      <h2>Who can see your frees</h2>
      ${viewers.length
        ? viewers.map(v => personRow(v.name, '', `<button class="secondary small danger" data-revoke="${esc(v.id)}">Remove access</button>`)).join('')
        : '<p class="empty">Nobody yet. People appear here once you approve their request.</p>'}
      <div class="status" id="viewerStatus"></div>
    </div>

    <div class="card">
      <h2>Friends you follow</h2>
      <p class="who-you">Add a friend's code to ask to see their frees. They'll show on your calendar once they approve.</p>
      ${me.following.length
        ? me.following.map(f => personRow(f.name,
            f.status === 'approved' ? 'approved' : 'waiting for approval',
            `<button class="secondary small" data-unfollow="${esc(f.id)}">${f.status === 'approved' ? 'Unfollow' : 'Cancel request'}</button>`)).join('')
        : '<p class="empty">You haven\'t added anyone yet.</p>'}
      <div class="row">
        <input type="text" id="friendCode" placeholder="friend's code, e.g. apple.river.stone" autocomplete="off" autocapitalize="off" spellcheck="false">
        <button id="addFriendBtn">Add</button>
      </div>
      <div class="status" id="friendStatus"></div>
    </div>

    <div class="card">
      <h2>Your frees</h2>
      <p class="who-you">You've marked <b>${me.free.length}</b> free slot${me.free.length === 1 ? '' : 's'} across both weeks.</p>
      <button id="editFreesBtn">Edit my frees</button>
    </div>

    <div class="card danger-zone">
      <h2>Delete account</h2>
      <p class="who-you">Permanently deletes your account, your frees, and everyone's access to them. Your code will stop working.</p>
      ${confirmingDelete
        ? `<p class="warn-note">Are you sure? This can't be undone.</p>
           <div class="row">
             <button class="danger-btn" id="confirmDeleteBtn">Yes, delete my account</button>
             <button class="secondary" id="cancelDeleteBtn">Cancel</button>
           </div>`
        : '<button class="secondary danger" id="deleteBtn">Delete my account</button>'}
      <div class="status" id="deleteStatus"></div>
    </div>
  `;

  document.getElementById('showCodeBtn').onclick = e => {
    const code = document.querySelector('#myCode .code');
    code.classList.toggle('hidden');
    e.target.textContent = code.classList.contains('hidden') ? 'Show' : 'Hide';
  };
  document.getElementById('copyCodeBtn').onclick = () => copyText(me.code, 'codeStatus');

  body.querySelectorAll('[data-approve]').forEach(btn => {
    btn.onclick = () => act(api.approveViewer(btn.dataset.approve), 'viewerStatus', 'Approved — they can now see your frees.');
  });
  body.querySelectorAll('[data-decline]').forEach(btn => {
    btn.onclick = () => act(api.removeViewer(btn.dataset.decline), 'requestStatus', 'Request declined.');
  });
  body.querySelectorAll('[data-revoke]').forEach(btn => {
    btn.onclick = () => act(api.removeViewer(btn.dataset.revoke), 'viewerStatus', "Done — they can't see your frees any more.");
  });
  body.querySelectorAll('[data-unfollow]').forEach(btn => {
    btn.onclick = () => act(api.unfollow(btn.dataset.unfollow), 'friendStatus', 'Removed.');
  });

  const friendInput = document.getElementById('friendCode');
  const addFriend = () => {
    const code = friendInput.value.trim();
    if(!code) return;
    setStatus('friendStatus', 'Adding...');
    const before = me.following.length;
    act(api.follow(code), 'friendStatus', null).then(() => {
      if(me.following.length > before) setStatus('friendStatus', "Request sent — they'll appear on your calendar once they approve.");
      else if(!document.getElementById('friendStatus').classList.contains('error')) setStatus('friendStatus', "They're already on your list.");
    });
  };
  friendInput.addEventListener('keydown', e => { if(e.key === 'Enter') addFriend(); });
  document.getElementById('addFriendBtn').onclick = addFriend;

  document.getElementById('editFreesBtn').onclick = () => {
    selected = new Set(me.free);
    setupWeek = config.weeks[0];
    renderSetup();
  };

  if(confirmingDelete){
    document.getElementById('cancelDeleteBtn').onclick = () => { confirmingDelete = false; renderAccount(); };
    document.getElementById('confirmDeleteBtn').onclick = async () => {
      setStatus('deleteStatus', 'Deleting...');
      try{
        await api.deleteAccount();
        me = null;
        api.code = null;
        confirmingDelete = false;
        renderNameEntry('Your account has been deleted.');
      }catch(e){
        setStatus('deleteStatus', e.message, true);
      }
    };
  }else{
    document.getElementById('deleteBtn').onclick = () => { confirmingDelete = true; renderAccount(); };
  }
}

// ---- Start ---------------------------------------------------------------

if(api.configured()){
  renderNameEntry();
}else{
  app.innerHTML = `<div class="card"><p class="empty">FreeFinder isn't connected to a database yet. Put your Supabase URL and key in <code>frontend/config.js</code> — see the README.</p></div>`;
}
