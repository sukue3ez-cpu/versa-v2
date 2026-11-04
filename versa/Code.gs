/**
 * Versa Virtual Broker — Google Apps Script backend
 * Demo/MVP only. Do not store real broker credentials or real-money balances here.
 *
 * SETUP:
 * 1) Create a Google Sheet.
 * 2) Extensions > Apps Script. Paste this file as Code.gs and Index.html as Index.html.
 * 3) In Project Settings > Script Properties add:
 *      SPREADSHEET_ID = your spreadsheet ID
 *      OWNER_EMAIL = your Google account email
 *      OWNER_PASSWORD = a long unique password (change before deployment)
 * 4) Run setupDatabase() once from the editor and authorize.
 * 5) Deploy > New deployment > Web app; Execute as: Me; Who has access: Anyone.
 */
const APP_NAME = 'Versa Virtual Broker';
const SESSION_TTL_SECONDS = 21600;
const SHEETS = {
  USERS: 'Users',
  ACCOUNTS: 'TradingAccounts',
  REQUESTS: 'AccountRequests',
  DEPOSITS: 'Deposits',
  WITHDRAWALS: 'Withdrawals',
  TRANSACTIONS: 'Transactions',
  LOGS: 'ActivityLogs'
};

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}


/**
 * JSON API bridge for the Vercel-hosted frontend.
 * Deploy this Apps Script as a Web App (execute as owner).
 */
function doPost(e) {
  const allowed = {
    register: register,
    login: login,
    logout: logout,
    getAppData: getAppData,
    submitAccountRequest: submitAccountRequest,
    submitDeposit: submitDeposit,
    uploadDepositProof: uploadDepositProof,
    submitWithdrawal: submitWithdrawal,
    ownerReviewWithdrawal: ownerReviewWithdrawal,
    ownerReviewAccount: ownerReviewAccount,
    ownerReviewDeposit: ownerReviewDeposit,
    ownerDeleteAccount: ownerDeleteAccount,
    ownerDeleteMember: ownerDeleteMember
  };
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const name = String(body.name || '');
    const args = Array.isArray(body.args) ? body.args : [];
    if (!Object.prototype.hasOwnProperty.call(allowed, name)) {
      throw new Error('Aksi API tidak diizinkan.');
    }
    const result = allowed[name].apply(null, args);
    return ContentService
      .createTextOutput(JSON.stringify(result === undefined ? {ok:true} : result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({error: err && err.message ? err.message : 'Terjadi kesalahan server.'}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function setupDatabase() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Tambahkan SPREADSHEET_ID di Script Properties terlebih dahulu.');
  const ss = SpreadsheetApp.openById(id);
  const definitions = [
    [SHEETS.USERS, ['userId','name','email','phone','passwordHash','salt','role','status','createdAt']],
    [SHEETS.ACCOUNTS, ['accountId','userId','displayName','accountType','loginId','tradingPassword','server','balance','currency','status','createdAt','updatedAt']],
    [SHEETS.REQUESTS, ['requestId','userId','displayName','accountType','proposedPasswordHash','proposedPasswordSalt','status','ownerNote','createdAt','reviewedAt']],
    [SHEETS.DEPOSITS, ['depositId','userId','accountId','method','amountRequested','amountCredited','currency','paymentReference','status','ownerNote','createdAt','reviewedAt','evidenceUrl','evidenceFileId']],
    [SHEETS.WITHDRAWALS, ['withdrawalId','userId','accountId','amount','currency','status','note','createdAt','reviewedAt']],
    [SHEETS.TRANSACTIONS, ['transactionId','userId','accountId','type','amount','currency','description','createdAt']],
    [SHEETS.LOGS, ['logId','actorId','action','details','createdAt']]
  ];
  definitions.forEach(([name, headers]) => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.appendRow(headers);
      sh.setFrozenRows(1);
      sh.getRange(1,1,1,headers.length).setFontWeight('bold').setBackground('#e9f7f2');
      sh.autoResizeColumns(1, headers.length);
    } else {
      // Add newly introduced columns at the end without changing existing data.
      const existing = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
      headers.forEach(h => { if (existing.indexOf(h) === -1) { sh.getRange(1,sh.getLastColumn()+1).setValue(h); existing.push(h); } });
    }
  });
  // Authorize Drive access and prepare a private folder for uploaded demo evidence.
  if (!props.getProperty('EVIDENCE_FOLDER_ID')) {
    const folder = DriveApp.createFolder('Versa Deposit Evidence - Private');
    props.setProperty('EVIDENCE_FOLDER_ID', folder.getId());
  }
  return 'Database siap. Sheet dibuat/diperiksa: ' + definitions.map(x => x[0]).join(', ');
}

/* ---------- Authentication ---------- */
function register(payload) {
  payload = payload || {};
  const name = clean_(payload.name, 80);
  const email = clean_(payload.email, 120).toLowerCase();
  const phone = clean_(payload.phone, 30);
  const password = String(payload.password || '');
  if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Nama dan email yang valid wajib diisi.');
  if (password.length < 8) throw new Error('Password aplikasi minimal 8 karakter.');
  const sh = sheet_(SHEETS.USERS);
  if (findRow_(sh, 3, email)) throw new Error('Email sudah terdaftar.');
  const salt = Utilities.getUuid();
  const id = uuid_('USR');
  sh.appendRow([id,name,email,phone,hash_(password,salt),salt,'member','active',now_()]);
  log_(id,'REGISTER','Member baru mendaftar');
  return {ok:true, message:'Pendaftaran berhasil. Silakan masuk.'};
}

function login(payload) {
  payload = payload || {};
  const email = clean_(payload.email,120).toLowerCase();
  const password = String(payload.password || '');
  const ownerEmail = (PropertiesService.getScriptProperties().getProperty('OWNER_EMAIL') || '').toLowerCase();
  const ownerPassword = PropertiesService.getScriptProperties().getProperty('OWNER_PASSWORD') || '';
  let user;
  if (email && email === ownerEmail && ownerPassword && constantTimeEqual_(password, ownerPassword)) {
    user = {userId:'OWNER', name:'Owner', email:ownerEmail, role:'owner', status:'active'};
  } else {
    const row = findRow_(sheet_(SHEETS.USERS), 3, email);
    if (!row) throw new Error('Email atau password salah.');
    const data = row.values;
    if (data[7] !== 'active' || hash_(password, data[5]) !== data[4]) throw new Error('Email atau password salah / akun nonaktif.');
    user = {userId:data[0], name:data[1], email:data[2], role:data[6], status:data[7]};
  }
  const token = Utilities.getUuid() + Utilities.getUuid();
  CacheService.getScriptCache().put('sess_' + token, JSON.stringify(user), SESSION_TTL_SECONDS);
  log_(user.userId,'LOGIN','Login berhasil');
  return {ok:true, token:token, user:user};
}

function logout(token) {
  if (token) CacheService.getScriptCache().remove('sess_' + token);
  return {ok:true};
}

function getAppData(token) {
  const u = auth_(token);
  if (u.role === 'owner') return {user:u, owner:true, requests:listRequests_(), deposits:listDeposits_(), withdrawals:listWithdrawals_(), members:listMembers_(), accounts:listAccounts_()};
  return {user:u, owner:false, accounts:listAccounts_(u.userId), deposits:listDeposits_(u.userId), withdrawals:listWithdrawals_(u.userId), requests:listRequests_(u.userId)};
}

/* ---------- Member actions ---------- */
function submitAccountRequest(token, payload) {
  const u = auth_(token); requireMember_(u);
  payload = payload || {};
  const displayName = clean_(payload.displayName,80);
  const type = payload.accountType === 'Cent' ? 'Cent' : 'Standard';
  const proposed = String(payload.tradingPassword || '');
  if (!displayName) throw new Error('Nama akun wajib diisi.');
  if (proposed.length < 8) throw new Error('Password trading awal minimal 8 karakter.');
  const salt = Utilities.getUuid();
  sheet_(SHEETS.REQUESTS).appendRow([uuid_('REQ'),u.userId,displayName,type,hash_(proposed,salt),salt,'pending','',now_(),'']);
  log_(u.userId,'ACCOUNT_REQUEST','Permintaan akun ' + type);
  return {ok:true,message:'Permintaan akun dikirim dan menunggu persetujuan owner.'};
}

function submitDeposit(token, payload) {
  const u = auth_(token); requireMember_(u);
  payload = payload || {};
  const accountId = clean_(payload.accountId,80);
  const method = payload.method === 'SeaBank' ? 'SeaBank' : 'DANA';
  const amount = Number(payload.amount);
  if (!accountId || !Number.isFinite(amount) || amount < 10000) throw new Error('Pilih akun dan masukkan nominal minimal Rp10.000.');
  const acc = findById_(sheet_(SHEETS.ACCOUNTS),1,accountId);
  if (!acc || acc.values[1] !== u.userId || acc.values[9] !== 'active') throw new Error('Akun tidak ditemukan atau belum aktif.');
  const depositId = uuid_('DEP');
  sheet_(SHEETS.DEPOSITS).appendRow([depositId,u.userId,accountId,method,amount,0,'IDR','', 'awaiting_proof','',now_(),'','','']);
  log_(u.userId,'DEPOSIT_STARTED','Simulasi deposit ' + method + ' Rp' + amount);
  // Demo-only instructions: no live payment destination is supplied or processed.
  return {ok:true,depositId:depositId,method:method,amount:amount,recipientName:'Kamsih (SIMULASI)',destination:method === 'DANA' ? 'NOMOR DEMO DANA — BUKAN REKENING AKTIF' : 'NOMOR DEMO SEABANK — BUKAN REKENING AKTIF',message:'Permintaan simulasi dibuat. Lanjutkan dengan mengunggah gambar bukti simulasi.'};
}

function uploadDepositProof(token, payload) {
  const u = auth_(token); requireMember_(u);
  payload = payload || {};
  const depositId = clean_(payload.depositId,80);
  const fileName = clean_(payload.fileName || 'bukti-simulasi',100);
  const mime = String(payload.mimeType || '');
  const data = String(payload.data || '');
  if (!/^image\/(jpeg|png|webp)$/.test(mime)) throw new Error('File harus berupa JPG, PNG, atau WEBP.');
  if (!data || data.length > 1800000) throw new Error('Ukuran gambar terlalu besar. Maksimal sekitar 1,3 MB.');
  const dep = findById_(sheet_(SHEETS.DEPOSITS),1,depositId);
  if (!dep || dep.values[1] !== u.userId || dep.values[8] !== 'awaiting_proof') throw new Error('Permintaan deposit tidak ditemukan atau bukti sudah dikirim.');
  const props = PropertiesService.getScriptProperties();
  let folderId = props.getProperty('EVIDENCE_FOLDER_ID');
  let folder;
  if (folderId) { try { folder = DriveApp.getFolderById(folderId); } catch(e) { folder = null; } }
  if (!folder) { folder = DriveApp.createFolder('Versa Deposit Evidence - Private'); props.setProperty('EVIDENCE_FOLDER_ID',folder.getId()); }
  const bytes = Utilities.base64Decode(data);
  const blob = Utilities.newBlob(bytes,mime,fileName.replace(/[^a-zA-Z0-9._-]/g,'_'));
  const file = folder.createFile(blob);
  // Keep the folder/file private; the script owner can review it in Drive.
  const sh = dep.sheet;
  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
  const urlCol = headers.indexOf('evidenceUrl') + 1;
  const idCol = headers.indexOf('evidenceFileId') + 1;
  if (urlCol > 0) sh.getRange(dep.row,urlCol).setValue(file.getUrl());
  if (idCol > 0) sh.getRange(dep.row,idCol).setValue(file.getId());
  sh.getRange(dep.row,9).setValue('pending');
  log_(u.userId,'DEPOSIT_PROOF_UPLOADED','Bukti simulasi diunggah untuk ' + depositId);
  return {ok:true,message:'Bukti simulasi berhasil dikirim dan menunggu pemeriksaan owner.'};
}

function submitWithdrawal(token, payload) {
  const u = auth_(token); requireMember_(u);
  payload = payload || {};
  const accountId = clean_(payload.accountId,80);
  const amount = Number(payload.amount);
  if (!accountId || !Number.isFinite(amount) || amount < 160000) throw new Error('Minimal penarikan simulasi adalah Rp160.000.');
  const acc = findById_(sheet_(SHEETS.ACCOUNTS),1,accountId);
  if (!acc || acc.values[1] !== u.userId || acc.values[9] !== 'active') throw new Error('Akun tidak ditemukan atau belum aktif.');
  if (acc.values[8] !== 'IDR') throw new Error('Penarikan hanya tersedia untuk akun bersatuan IDR.');
  const balance = Number(acc.values[7] || 0);
  if (amount > balance) throw new Error('Nominal melebihi saldo akun. Saldo tersedia: Rp' + balance.toLocaleString('id-ID'));
  const pending = rows_(SHEETS.WITHDRAWALS).some(r => r[1] === u.userId && r[2] === accountId && r[5] === 'pending');
  if (pending) throw new Error('Masih ada permintaan penarikan yang menunggu pemeriksaan untuk akun ini.');
  const id = uuid_('WDR');
  sheet_(SHEETS.WITHDRAWALS).appendRow([id,u.userId,accountId,amount,'IDR','pending','',now_(),'']);
  log_(u.userId,'WITHDRAWAL_REQUEST','Permintaan penarikan simulasi Rp' + amount);
  return {ok:true,message:'Permintaan penarikan simulasi dikirim. Saldo belum berubah sampai owner menyetujui.'};
}


/* ---------- Owner actions ---------- */
function ownerReviewAccount(token, payload) {
  const u = auth_(token); requireOwner_(u);
  payload = payload || {};
  const requestId = clean_(payload.requestId,80);
  const decision = payload.decision === 'reject' ? 'rejected' : 'approved';
  const loginId = clean_(payload.loginId,80);
  const password = String(payload.tradingPassword || '');
  const server = clean_(payload.server,100);
  const note = clean_(payload.note,250);
  const req = findById_(sheet_(SHEETS.REQUESTS),1,requestId);
  if (!req || req.values[6] !== 'pending') throw new Error('Permintaan tidak ditemukan atau sudah diproses.');
  const r = req.values;
  if (decision === 'approved') {
    if (!loginId || password.length < 8 || !server) throw new Error('Login ID, password trading minimal 8 karakter, dan server wajib diisi.');
    const accountId = uuid_('ACC');
    sheet_(SHEETS.ACCOUNTS).appendRow([accountId,r[1],r[2],r[3],loginId,password,server,0,r[3] === 'Cent' ? 'USC' : 'IDR','active',now_(),now_()]);
    sheet_(SHEETS.TRANSACTIONS).appendRow([uuid_('TXN'),r[1],accountId,'account_created',0,r[3] === 'Cent' ? 'USC' : 'IDR','Akun trading dibuat',now_()]);
  }
  req.sheet.getRange(req.row,7).setValue(decision);
  req.sheet.getRange(req.row,8).setValue(note);
  req.sheet.getRange(req.row,10).setValue(now_());
  log_(u.userId,'REVIEW_ACCOUNT',requestId + ' ' + decision);
  return {ok:true,message:decision === 'approved' ? 'Akun trading disetujui.' : 'Permintaan ditolak.'};
}

function ownerReviewDeposit(token, payload) {
  const u = auth_(token); requireOwner_(u);
  payload = payload || {};
  const depositId = clean_(payload.depositId,80);
  const decision = payload.decision === 'reject' ? 'rejected' : 'approved';
  const credited = Number(payload.amountCredited);
  const note = clean_(payload.note,250);
  const dep = findById_(sheet_(SHEETS.DEPOSITS),1,depositId);
  if (!dep || dep.values[8] !== 'pending') throw new Error('Deposit tidak ditemukan atau sudah diproses.');
  const d = dep.values;
  if (decision === 'approved') {
    if (!Number.isFinite(credited) || credited <= 0) throw new Error('Masukkan jumlah saldo yang akan dikreditkan.');
    const acc = findById_(sheet_(SHEETS.ACCOUNTS),1,d[2]);
    if (!acc) throw new Error('Akun tujuan tidak ditemukan.');
    const balanceCol = 8;
    const newBalance = Number(acc.values[7] || 0) + credited;
    acc.sheet.getRange(acc.row,balanceCol).setValue(newBalance);
    acc.sheet.getRange(acc.row,12).setValue(now_());
    sheet_(SHEETS.TRANSACTIONS).appendRow([uuid_('TXN'),d[1],d[2],'deposit',credited,d[6],'Deposit disetujui ' + d[0],now_()]);
    dep.sheet.getRange(dep.row,6).setValue(credited);
  }
  dep.sheet.getRange(dep.row,9).setValue(decision);
  dep.sheet.getRange(dep.row,10).setValue(note);
  dep.sheet.getRange(dep.row,12).setValue(now_());
  log_(u.userId,'REVIEW_DEPOSIT',depositId + ' ' + decision + ' credited=' + (decision === 'approved' ? credited : 0));
  return {ok:true,message:decision === 'approved' ? 'Deposit disetujui dan saldo diperbarui.' : 'Deposit ditolak.'};
}


function ownerReviewWithdrawal(token, payload) {
  const u = auth_(token); requireOwner_(u);
  payload = payload || {};
  const id = clean_(payload.withdrawalId,80);
  const decision = payload.decision === 'reject' ? 'rejected' : 'approved';
  const note = clean_(payload.note,250);
  const req = findById_(sheet_(SHEETS.WITHDRAWALS),1,id);
  if (!req || req.values[5] !== 'pending') throw new Error('Permintaan penarikan tidak ditemukan atau sudah diproses.');
  const r = req.values;
  if (decision === 'approved') {
    const acc = findById_(sheet_(SHEETS.ACCOUNTS),1,r[2]);
    if (!acc || acc.values[1] !== r[1] || acc.values[9] !== 'active') throw new Error('Akun tujuan tidak tersedia.');
    const balance = Number(acc.values[7] || 0);
    const amount = Number(r[3] || 0);
    if (amount < 160000 || amount > balance) throw new Error('Saldo berubah atau tidak mencukupi. Periksa ulang permintaan.');
    acc.sheet.getRange(acc.row,8).setValue(balance - amount);
    acc.sheet.getRange(acc.row,12).setValue(now_());
    sheet_(SHEETS.TRANSACTIONS).appendRow([uuid_('TXN'),r[1],r[2],'withdrawal',-amount,r[4],'Penarikan simulasi disetujui ' + id,now_()]);
  }
  req.sheet.getRange(req.row,6).setValue(decision);
  req.sheet.getRange(req.row,7).setValue(note);
  req.sheet.getRange(req.row,9).setValue(now_());
  log_(u.userId,'REVIEW_WITHDRAWAL',id + ' ' + decision);
  return {ok:true,message:decision === 'approved' ? 'Penarikan simulasi disetujui dan saldo simulasi dikurangi.' : 'Permintaan penarikan ditolak.'};
}



/** Owner-only soft deletion. Rows remain in Sheets for audit history. */
function ownerDeleteAccount(token, payload) {
  const u = auth_(token); requireOwner_(u);
  const accountId = clean_(payload && payload.accountId, 80);
  const acc = findById_(sheet_(SHEETS.ACCOUNTS), 1, accountId);
  if (!acc) throw new Error('Akun tidak ditemukan.');
  if (acc.values[9] === 'deleted') throw new Error('Akun sudah dihapus.');
  acc.sheet.getRange(acc.row, 10).setValue('deleted');
  acc.sheet.getRange(acc.row, 12).setValue(now_());
  sheet_(SHEETS.TRANSACTIONS).appendRow([uuid_('TXN'), acc.values[1], accountId, 'account_deleted', 0, acc.values[8], 'Akun dinonaktifkan oleh owner', now_()]);
  log_(u.userId, 'DELETE_ACCOUNT', accountId);
  return {ok:true, message:'Akun berhasil dihapus dari tampilan (riwayat tetap tersimpan).'};
}

function ownerDeleteMember(token, payload) {
  const u = auth_(token); requireOwner_(u);
  const userId = clean_(payload && payload.userId, 80);
  if (!userId || userId === 'OWNER') throw new Error('Member tidak valid.');
  const member = findById_(sheet_(SHEETS.USERS), 1, userId);
  if (!member) throw new Error('Member tidak ditemukan.');
  if (member.values[7] === 'deleted') throw new Error('Member sudah dihapus.');
  member.sheet.getRange(member.row, 8).setValue('deleted');
  const accounts = sheet_(SHEETS.ACCOUNTS);
  if (accounts.getLastRow() >= 2) {
    const vals = accounts.getRange(2, 1, accounts.getLastRow()-1, accounts.getLastColumn()).getValues();
    vals.forEach((r, i) => { if (r[1] === userId) { accounts.getRange(i+2, 10).setValue('deleted'); accounts.getRange(i+2, 12).setValue(now_()); } });
  }
  log_(u.userId, 'DELETE_MEMBER', userId + ' (soft delete; history retained)');
  return {ok:true, message:'Member dinonaktifkan dan tidak dapat login lagi. Riwayat tetap tersimpan.'};
}

function ownerSetAccountPassword(token, payload) {
  const u = auth_(token); requireOwner_(u);
  payload = payload || {};
  const accountId = clean_(payload.accountId,80);
  const password = String(payload.tradingPassword || '');
  if (password.length < 8) throw new Error('Password trading minimal 8 karakter.');
  const acc = findById_(sheet_(SHEETS.ACCOUNTS),1,accountId);
  if (!acc) throw new Error('Akun tidak ditemukan.');
  acc.sheet.getRange(acc.row,6).setValue(password);
  acc.sheet.getRange(acc.row,12).setValue(now_());
  log_(u.userId,'RESET_TRADING_PASSWORD',accountId);
  return {ok:true,message:'Password trading diperbarui.'};
}

/* ---------- Data helpers ---------- */
function listAccounts_(userId) {
  return rows_(SHEETS.ACCOUNTS).filter(r => (!userId || r[1] === userId) && (userId ? r[9] !== 'deleted' : true)).map(r => ({
    accountId:r[0],displayName:r[2],accountType:r[3],loginId:r[4],tradingPassword:r[5],
    server:r[6],balance:Number(r[7]||0),currency:r[8],status:r[9],createdAt:dateText_(r[10])
  }));
}
function listRequests_(userId) {
  return rows_(SHEETS.REQUESTS).filter(r => !userId || r[1] === userId).map(r => ({
    requestId:r[0],displayName:r[2],accountType:r[3],status:r[6],ownerNote:r[7],createdAt:dateText_(r[8]),userId:r[1]
  }));
}
function listDeposits_(userId) {
  return rows_(SHEETS.DEPOSITS).filter(r => !userId || r[1] === userId).map(r => ({
    depositId:r[0],accountId:r[2],method:r[3],amountRequested:Number(r[4]||0),amountCredited:Number(r[5]||0),
    currency:r[6],paymentReference:r[7],status:r[8],ownerNote:r[9],createdAt:dateText_(r[10]),userId:r[1],
    evidenceUrl:r[12] || ''
  }));
}
function listWithdrawals_(userId) {
  return rows_(SHEETS.WITHDRAWALS).filter(r => !userId || r[1] === userId).map(r => ({
    withdrawalId:r[0],userId:r[1],accountId:r[2],amount:Number(r[3]||0),currency:r[4],status:r[5],note:r[6],createdAt:dateText_(r[7])
  }));
}
function listMembers_() {
  return rows_(SHEETS.USERS).map(r => ({userId:r[0],name:r[1],email:r[2],phone:r[3],status:r[7],createdAt:dateText_(r[8])}));
}
function requireOwner_(u) { if (u.role !== 'owner') throw new Error('Akses khusus owner.'); }
function requireMember_(u) { if (u.role !== 'member') throw new Error('Aksi ini hanya untuk member.'); }
function auth_(token) {
  if (!token) throw new Error('Sesi berakhir. Silakan login kembali.');
  const raw = CacheService.getScriptCache().get('sess_' + token);
  if (!raw) throw new Error('Sesi berakhir. Silakan login kembali.');
  return JSON.parse(raw);
}
function ss_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('SPREADSHEET_ID belum diatur di Script Properties.');
  return SpreadsheetApp.openById(id);
}
function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('Sheet ' + name + ' belum ada. Jalankan setupDatabase().');
  return sh;
}
function rows_(name) {
  const sh = sheet_(name);
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).getValues();
}
function findRow_(sh, col, value) {
  if (sh.getLastRow() < 2) return null;
  const vals = sh.getRange(2,col,sh.getLastRow()-1,1).getValues();
  for (let i=0;i<vals.length;i++) if (String(vals[i][0]).toLowerCase() === String(value).toLowerCase()) {
    const row = i+2; return {sheet:sh,row:row,values:sh.getRange(row,1,1,sh.getLastColumn()).getValues()[0]};
  }
  return null;
}
function findById_(sh, col, value) {
  if (sh.getLastRow() < 2) return null;
  const vals = sh.getRange(2,col,sh.getLastRow()-1,1).getValues();
  for (let i=0;i<vals.length;i++) if (String(vals[i][0]) === String(value)) {
    const row = i+2; return {sheet:sh,row:row,values:sh.getRange(row,1,1,sh.getLastColumn()).getValues()[0]};
  }
  return null;
}
function hash_(value,salt) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + value, Utilities.Charset.UTF_8);
  return bytes.map(b => ('0' + ((b+256)%256).toString(16)).slice(-2)).join('');
}
function constantTimeEqual_(a,b) {
  a=String(a); b=String(b); if (a.length !== b.length) return false;
  let out=0; for(let i=0;i<a.length;i++) out |= a.charCodeAt(i)^b.charCodeAt(i); return out===0;
}
function clean_(v,max) { return String(v == null ? '' : v).trim().replace(/[<>]/g,'').slice(0,max); }
function uuid_(prefix) { return prefix + '-' + Utilities.getUuid().toUpperCase(); }
function now_() { return new Date(); }
function dateText_(v) { return v instanceof Date ? v.toISOString() : String(v || ''); }
function log_(actor,action,details) {
  try { sheet_(SHEETS.LOGS).appendRow([uuid_('LOG'),actor,action,clean_(details,300),now_()]); } catch(e) {}
}
