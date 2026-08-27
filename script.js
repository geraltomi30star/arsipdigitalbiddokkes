const CATEGORIES = [
  {id:'rahasia', label:'Surat Rahasia', color:'#B3261E'},
  {id:'biasa', label:'Surat Biasa', color:'#1A73E8'},
  {id:'nota-dinas', label:'Nota Dinas', color:'#188038'},
  {id:'perjalanan-dinas', label:'Surat Perjalanan Dinas', color:'#F9AB00'},
  {id:'perintah', label:'Surat Perintah', color:'#9334E6'},
  {id:'keterangan', label:'Surat Keterangan', color:'#12A4AF'},
  {id:'keputusan', label:'Surat Keputusan', color:'#8C6A1F'},
  {id:'telegram', label:'Surat Telegram', color:'#E37400'},
  {id:'str', label:'STR', color:'#00897B'},
  {id:'rekomendasi', label:'Surat Rekomendasi', color:'#5C6BC0'},
  {id:'mou', label:'MoU', color:'#C2185B'},
  {id:'tugas', label:'Surat Tugas', color:'#D93025'},
  {id:'cuti-izin', label:'Surat Cuti dan Izin', color:'#795548'},
  {id:'pernyataan', label:'Surat Pernyataan', color:'#0B8043'},
];

// Status default per kategori: dipakai untuk otomatis mengisi status saat
// kategori dipilih. Tetap bisa diubah manual sesudahnya kalau perlu.
// Nilai id di sini ("aktif"/"selesai"/"arsip") adalah kode internal saja;
// label yang tampil ke pengguna diatur terpisah lewat STATUS_LABELS di bawah.
const CATEGORY_DEFAULT_STATUS = {
  'rahasia': 'aktif',
  'biasa': 'selesai',
  'nota-dinas': 'selesai',
  'perjalanan-dinas': 'aktif',
  'perintah': 'aktif',
  'keterangan': 'selesai',
  'keputusan': 'selesai',
  'telegram': 'aktif',
  'str': 'aktif',
  'rekomendasi': 'selesai',
  'mou': 'aktif',
  'tugas': 'aktif',
  'cuti-izin': 'aktif',
  'pernyataan': 'selesai',
};
function defaultStatusForCategory(kategoriId){
  return CATEGORY_DEFAULT_STATUS[kategoriId] || 'aktif';
}

// Kategori yang secara alami punya "masa berlaku" (bukan berlaku selamanya).
// Untuk kategori ini, form menampilkan kolom "Berlaku sampai / Tenggat".
// Begitu tanggal itu terlewati, status surat yang masih "Aktif" otomatis
// dipindah ke "Selesai" saat aplikasi dibuka.
// Semua kategori berstatus default "aktif" dimasukkan ke sini, supaya tidak
// ada lagi kategori aktif yang cuma bisa diarsipkan manual.
const CATEGORIES_WITH_DEADLINE = ['rahasia', 'perjalanan-dinas', 'perintah', 'telegram', 'str', 'mou', 'tugas', 'cuti-izin'];
function categoryHasDeadline(kategoriId){
  return CATEGORIES_WITH_DEADLINE.includes(kategoriId);
}

// Kategori yang sifatnya administratif internal (bukan korespondensi
// masuk/keluar klasik), jadi field "Arah surat" disembunyikan untuk ini.
const CATEGORIES_WITHOUT_ARAH = ['cuti-izin', 'pernyataan'];
function categoryHasArah(kategoriId){
  return !CATEGORIES_WITHOUT_ARAH.includes(kategoriId);
}

const STORAGE_KEY = 'biddokkes-arsip-records';
const SAMPUL_STORAGE_KEY = 'biddokkes-sampul-list';
const SAMPUL_COLORS = ['#1A73E8','#D93025','#188038','#F9AB00','#9334E6','#12A4AF','#8C6A1F','#B3261E'];
let records = [];
let sampulList = [];
let currentView = 'dashboard';
let currentCategory = null;
let currentSampulId = null;
let editingId = null;
let editingSampulId = null;
let displayMode = 'list';
let pendingFile = null;
let detailId = null;

function catObj(id){return CATEGORIES.find(c=>c.id===id);}
function catLabel(id){const c=catObj(id);return c?c.label:id;}
function catColor(id){const c=catObj(id);return c?c.color:'#5F6368';}

function formatTanggal(iso){
  if(!iso) return '-';
  try{
    const d = new Date(iso+'T00:00:00');
    return d.toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric'});
  }catch(e){return iso;}
}

function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 2200);
}

// Adaptor penyimpanan: memakai window.storage bila tersedia (mis. saat dibuka
// sebagai artifact Claude), atau localStorage sebagai cadangan agar aplikasi
// tetap berfungsi saat file ini dijalankan mandiri (VS Code / hosting sendiri).
const localStorageAdapter = {
  async get(key){
    try{
      const v = localStorage.getItem(key);
      return v !== null ? { key, value: v, shared: false } : null;
    }catch(e){ return null; }
  },
  async set(key, value){
    try{
      localStorage.setItem(key, value);
      return { key, value, shared: false };
    }catch(e){ return null; }
  }
};
function getStorage(){
  if(typeof window !== 'undefined' && window.storage && typeof window.storage.get === 'function'){
    return window.storage;
  }
  return localStorageAdapter;
}

// Berkas hasil scan disimpan lewat IndexedDB, khusus saat aplikasi berjalan
// mandiri (di luar Claude), karena artifact Claude tidak mengizinkan API
// penyimpanan browser. STANDALONE menandai kondisi tersebut.
const STANDALONE = !(typeof window !== 'undefined' && window.storage && typeof window.storage.get === 'function');

const FILE_DB_NAME = 'biddokkes-arsip-files-db';
const FILE_STORE = 'files';
let filesDbPromise = null;
function openFilesDB(){
  if(!STANDALONE || !('indexedDB' in window)) return Promise.resolve(null);
  if(filesDbPromise) return filesDbPromise;
  filesDbPromise = new Promise(resolve=>{
    const req = indexedDB.open(FILE_DB_NAME, 1);
    req.onupgradeneeded = ()=>{ req.result.createObjectStore(FILE_STORE); };
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> resolve(null);
  });
  return filesDbPromise;
}
async function saveFileBlob(id, file){
  const db = await openFilesDB();
  if(!db) return false;
  return new Promise(resolve=>{
    const tx = db.transaction(FILE_STORE, 'readwrite');
    tx.objectStore(FILE_STORE).put({blob:file, name:file.name, type:file.type, size:file.size}, id);
    tx.oncomplete = ()=>resolve(true);
    tx.onerror = ()=>resolve(false);
  });
}
async function getFileBlob(id){
  const db = await openFilesDB();
  if(!db) return null;
  return new Promise(resolve=>{
    const tx = db.transaction(FILE_STORE, 'readonly');
    const req = tx.objectStore(FILE_STORE).get(id);
    req.onsuccess = ()=> resolve(req.result || null);
    req.onerror = ()=> resolve(null);
  });
}
async function deleteFileBlob(id){
  const db = await openFilesDB();
  if(!db) return;
  const tx = db.transaction(FILE_STORE, 'readwrite');
  tx.objectStore(FILE_STORE).delete(id);
}
function formatFileSize(bytes){
  if(!bytes) return '';
  if(bytes < 1024*1024) return Math.round(bytes/1024) + ' KB';
  return (bytes/(1024*1024)).toFixed(1) + ' MB';
}

async function loadRecords(){
  try{
    const res = await getStorage().get(STORAGE_KEY, true);
    records = res && res.value ? JSON.parse(res.value) : [];
  }catch(e){
    records = [];
  }
}
async function persist(){
  try{
    await getStorage().set(STORAGE_KEY, JSON.stringify(records), true);
  }catch(e){
    showToast('Gagal menyimpan data. Coba lagi.');
  }
}

async function loadSampul(){
  try{
    const res = await getStorage().get(SAMPUL_STORAGE_KEY, true);
    sampulList = res && res.value ? JSON.parse(res.value) : [];
  }catch(e){
    sampulList = [];
  }
}
async function persistSampul(){
  try{
    await getStorage().set(SAMPUL_STORAGE_KEY, JSON.stringify(sampulList), true);
  }catch(e){
    showToast('Gagal menyimpan sampul. Coba lagi.');
  }
}

function sampulColor(id){
  let hash = 0;
  for(let i=0;i<id.length;i++) hash = (hash*31 + id.charCodeAt(i)) % SAMPUL_COLORS.length;
  return SAMPUL_COLORS[Math.abs(hash)];
}
function sampulById(id){ return sampulList.find(s=>s.id===id); }
function sampulName(id){ const s = sampulById(id); return s ? s.nama : 'Tanpa sampul'; }

function buildCatNav(){
  const el = document.getElementById('cat-nav');
  el.innerHTML = '';
  CATEGORIES.forEach(c=>{
    const count = records.filter(r=>r.kategori===c.id).length;
    const div = document.createElement('div');
    div.className = 'nav-item';
    div.dataset.view = 'cat-'+c.id;
    div.onclick = ()=>setView('cat', c.id);
    div.innerHTML = `<span class="ic"><svg width="16" height="16" viewBox="0 0 24 24" fill="${c.color}"><path d="M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V6z"/></svg></span><span>${c.label}</span><span class="count">${count}</span>`;
    el.appendChild(div);
  });
}

function buildFormCategorySelect(){
  const sel = document.getElementById('f-kategori');
  sel.innerHTML = CATEGORIES.map(c=>`<option value="${c.id}">${c.label}</option>`).join('');
  const selS = document.getElementById('s-kategori');
  selS.innerHTML = '<option value="">Tidak terikat kategori</option>' + CATEGORIES.map(c=>`<option value="${c.id}">${c.label}</option>`).join('');
}

function populateFormSampulSelect(selectedId){
  const sorted = [...sampulList].sort((a,b)=> a.nama.localeCompare(b.nama, 'id', {sensitivity:'base'}));
  const sel = document.getElementById('f-sampul');
  sel.innerHTML = '<option value="">Tanpa sampul</option>' + sorted.map(s=>`<option value="${s.id}">${escapeHtml(s.nama)}</option>`).join('');
  sel.value = selectedId || '';
}

function setActiveNav(){
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  if(currentView==='dashboard') document.querySelector('[data-view="dashboard"]').classList.add('active');
  else if(currentView==='all') document.querySelector('[data-view="all"]').classList.add('active');
  else if(currentView==='sampul-list' || currentView==='sampul-detail') document.querySelector('[data-view="sampul-list"]').classList.add('active');
  else if(currentView==='cat'){const n=document.querySelector('[data-view="cat-'+currentCategory+'"]'); if(n) n.classList.add('active');}
  if(window.innerWidth<=760) document.querySelector('.sidebar').classList.remove('open');
}

function setView(view, cat){
  currentView = view;
  currentCategory = cat || null;
  setActiveNav();
  const bc = document.getElementById('breadcrumb');
  const sl = document.getElementById('sub-line');
  document.getElementById('dashboard-stats').classList.toggle('hidden', view!=='dashboard');
  if(view==='dashboard'){
    bc.textContent = 'Dasbor';
    sl.textContent = 'Ikhtisar arsip kesehatan dan administrasi Biddokkes';
  }else if(view==='all'){
    bc.innerHTML = 'Semua arsip';
    sl.textContent = records.length + ' surat, termasuk yang berada di dalam sampul — tersusun otomatis menurut abjad judul';
  }else if(view==='cat'){
    bc.textContent = catLabel(cat);
    sl.textContent = records.filter(r=>r.kategori===cat).length + ' dokumen dalam kategori ini';
  }else if(view==='sampul-list'){
    bc.textContent = 'Sampul surat';
    sl.textContent = sampulList.length + ' sampul tersimpan, diurutkan menurut abjad nama sampul';
  }else if(view==='sampul-detail'){
    currentSampulId = cat;
    const s = sampulById(cat);
    bc.innerHTML = `<span class="crumb" onclick="setView('sampul-list')">Sampul surat</span> <span class="sep">›</span> ${escapeHtml(s ? s.nama : '')}`;
    const n = records.filter(r=>r.sampulId===cat).length;
    sl.textContent = n + ' surat di dalam sampul ini, tersusun menurut abjad';
  }
  renderMain();
}

function setDisplayMode(mode){
  displayMode = mode;
  document.getElementById('view-list-btn').classList.toggle('active', mode==='list');
  document.getElementById('view-grid-btn').classList.toggle('active', mode==='grid');
  renderMain();
}

function fileIconSVG(catId){
  const color = catColor(catId);
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="${color}"><path d="M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V6z"/></svg>`;
}

function escapeHtml(s){
  if(!s) return '';
  return s.replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function getFiltered(){
  const q = (document.getElementById('search-input').value || '').toLowerCase().trim();
  const statusFilter = document.getElementById('status-filter').value;
  const arahFilter = document.getElementById('arah-filter').value;
  const sortBy = document.getElementById('sort-by').value;
  let list = records;
  if(currentView==='cat') list = list.filter(r=>r.kategori===currentCategory);
  if(statusFilter) list = list.filter(r=>r.status===statusFilter);
  if(arahFilter) list = list.filter(r=>r.arah===arahFilter);
  if(q){
    list = list.filter(r =>
      (r.judul||'').toLowerCase().includes(q) ||
      (r.nomor||'').toLowerCase().includes(q) ||
      (r.personel||'').toLowerCase().includes(q)
    );
  }
  list = [...list];
  if(sortBy==='nama') list.sort((a,b)=> a.judul.localeCompare(b.judul));
  else if(sortBy==='tanggal') list.sort((a,b)=> (b.tanggal||'').localeCompare(a.tanggal||''));
  else list.sort((a,b)=> (b.dibuatPada||0) - (a.dibuatPada||0));
  return list;
}

function statusMeta(status){
  return {
    aktif:{label:'Aktif', cls:'pill-aktif'},
    selesai:{label:'Diarsipkan', cls:'pill-selesai'},
    arsip:{label:'Selesai', cls:'pill-arsip'}
  }[status] || {label:status, cls:'pill-arsip'};
}

function listTableHTML(list){
  const rows = list.map(r=>{
    const sm = statusMeta(r.status);
    const fileTag = r.hasFile ? '<span class="file-tag" title="Ada berkas terlampir">&#128206;</span>' : '';
    const arahTag = r.arah ? `<span class="arah-tag arah-${r.arah}" title="${ARAH_LABELS[r.arah]}">${ARAH_ICON[r.arah]} ${ARAH_LABELS[r.arah]}</span>` : '';
    const nomorLine = r.nomor ? `<span class="n">${escapeHtml(r.nomor)}</span>` : '<span class="n n-empty">&nbsp;</span>';
    return `<tr onclick="openDetail('${r.id}')" oncontextmenu="showContextMenu(event,'${r.id}')">
      <td>
        <div class="file-name-cell">
          <div class="file-icon">${fileIconSVG(r.kategori)}</div>
          <div class="fn"><span class="t">${escapeHtml(r.judul)} ${fileTag}</span>${nomorLine}</div>
        </div>
      </td>
      <td class="col-muted">${catLabel(r.kategori)} ${arahTag}</td>
      <td class="col-muted">${formatTanggal(r.tanggal)}</td>
      <td><span class="pill ${sm.cls}">${sm.label}</span></td>
    </tr>`;
  }).join('');
  return `<table class="drive-table">
    <thead><tr><th>Nama</th><th>Kategori</th><th>Tanggal</th><th>Status</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function gridTileHTML(list){
  return `<div class="grid">${list.map(r=>{
    const sm = statusMeta(r.status);
    const fileTag = r.hasFile ? '<span class="file-tag" title="Ada berkas terlampir">&#128206;</span>' : '';
    const arahTag = r.arah ? `<span class="arah-tag arah-${r.arah}" title="${ARAH_LABELS[r.arah]}">${ARAH_ICON[r.arah]} ${ARAH_LABELS[r.arah]}</span>` : '';
    const nomorLine = r.nomor ? `<div class="n">${escapeHtml(r.nomor)}</div>` : '<div class="n n-empty">&nbsp;</div>';
    return `<div class="tile" onclick="openDetail('${r.id}')" oncontextmenu="showContextMenu(event,'${r.id}')">
      <div class="tile-top">
        <div class="file-icon" style="width:30px;height:30px;">${fileIconSVG(r.kategori)}</div>
        <span class="pill ${sm.cls}">${sm.label}</span>
      </div>
      <h4>${escapeHtml(r.judul)} ${fileTag}</h4>
      ${nomorLine}
      <div class="tile-foot">
        <span class="kat">${catLabel(r.kategori)}</span>${arahTag}
        <span class="kat">${formatTanggal(r.tanggal)}</span>
      </div>
    </div>`;
  }).join('')}</div>`;
}

function emptyStateHTML(){
  return `<div class="empty">
    <h3>Tidak ada dokumen</h3>
    <p>Coba ubah kata kunci pencarian, atau tambahkan arsip baru.</p>
    <button onclick="openForm()">+ Tambah arsip</button>
  </div>`;
}

function normalizeLetter(s){
  const c = (s||'').trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : '#';
}

function getAlphaSortDirection(){
  const el = document.getElementById('alpha-sort');
  return el ? el.value : 'asc';
}

function alphaIndexHTML(list){
  const dir = getAlphaSortDirection();
  const sorted = [...list].sort((a,b)=> dir==='desc'
    ? b.judul.localeCompare(a.judul, 'id', {sensitivity:'base'})
    : a.judul.localeCompare(b.judul, 'id', {sensitivity:'base'}));
  const groups = {};
  sorted.forEach(r=>{
    const letter = normalizeLetter(r.judul);
    if(!groups[letter]) groups[letter] = [];
    groups[letter].push(r);
  });
  const letters = Object.keys(groups).sort((a,b)=>{
    if(a==='#') return 1;
    if(b==='#') return -1;
    return dir==='desc' ? b.localeCompare(a) : a.localeCompare(b);
  });
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

  const jump = `<div class="alpha-jump">${alphabet.map(l=>{
    const has = groups[l] && groups[l].length;
    return `<a href="#letter-${l}" class="${has?'':'disabled'}">${l}</a>`;
  }).join('')}</div>`;

  if(!letters.length){
    return jump + emptyStateHTML();
  }

  const bodyRows = letters.map(letter=>{
    const groupHeader = `<tr class="alpha-group-row" id="letter-${letter}">
      <td colspan="4"><span class="letter">${letter}</span><span class="n">${groups[letter].length} surat</span></td>
    </tr>`;
    const rows = groups[letter].map(r=>{
      const sm = statusMeta(r.status);
      const fileTag = r.hasFile ? '<span class="file-tag" title="Ada berkas terlampir">&#128206;</span>' : '';
    const arahTag = r.arah ? `<span class="arah-tag arah-${r.arah}" title="${ARAH_LABELS[r.arah]}">${ARAH_ICON[r.arah]} ${ARAH_LABELS[r.arah]}</span>` : '';
      const nomorLine = r.nomor ? `<span class="n">${escapeHtml(r.nomor)}</span>` : '<span class="n n-empty">&nbsp;</span>';
      return `<tr onclick="openDetail('${r.id}')" oncontextmenu="showContextMenu(event,'${r.id}')">
        <td>
          <div class="file-name-cell">
            <div class="file-icon">${fileIconSVG(r.kategori)}</div>
            <div class="fn"><span class="t">${escapeHtml(r.judul)} ${fileTag}</span>${nomorLine}</div>
          </div>
        </td>
        <td class="col-muted">${catLabel(r.kategori)} ${arahTag}</td>
        <td class="col-muted">${formatTanggal(r.tanggal)}</td>
        <td><span class="pill ${sm.cls}">${sm.label}</span></td>
      </tr>`;
    }).join('');
    return groupHeader + rows;
  }).join('');

  return jump + `<table class="drive-table">
    <thead><tr><th>Nama</th><th>Kategori</th><th>Tanggal</th><th>Status</th></tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>`;
}

function sampulCardHTML(s){
  const color = sampulColor(s.id);
  const count = records.filter(r=>r.sampulId===s.id).length;
  return `<div class="sampul-card" onclick="setView('sampul-detail','${s.id}')">
    <div class="sampul-spine" style="background:${color};"></div>
    <div class="sampul-body">
      <h4>${escapeHtml(s.nama)}</h4>
      <div class="desc">${s.deskripsi ? escapeHtml(s.deskripsi) : (s.kategori ? catLabel(s.kategori) : 'Tanpa kategori terkait')}</div>
      <div class="count">${count} surat</div>
    </div>
  </div>`;
}

function sampulListHTML(){
  const q = (document.getElementById('search-input').value || '').toLowerCase().trim();
  const dir = getAlphaSortDirection();
  let list = sampulList;
  if(q) list = list.filter(s => (s.nama||'').toLowerCase().includes(q));
  const sorted = [...list].sort((a,b)=> dir==='desc'
    ? b.nama.localeCompare(a.nama, 'id', {sensitivity:'base'})
    : a.nama.localeCompare(b.nama, 'id', {sensitivity:'base'}));
  const groups = {};
  sorted.forEach(s=>{
    const letter = normalizeLetter(s.nama);
    if(!groups[letter]) groups[letter] = [];
    groups[letter].push(s);
  });
  const letters = Object.keys(groups).sort((a,b)=>{
    if(a==='#') return 1;
    if(b==='#') return -1;
    return dir==='desc' ? b.localeCompare(a) : a.localeCompare(b);
  });
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const jump = `<div class="alpha-jump">${alphabet.map(l=>{
    const has = groups[l] && groups[l].length;
    return `<a href="#sampul-letter-${l}" class="${has?'':'disabled'}">${l}</a>`;
  }).join('')}</div>`;
  const addBtn = `<div style="margin-bottom:16px;"><button class="btn-new" style="margin-bottom:0;" onclick="openSampulForm()"><span class="plus">+</span> Tambah sampul</button></div>`;

  if(sorted.length===0){
    return addBtn + jump + emptyStateHTML().replace('Tidak ada dokumen','Belum ada sampul').replace('Coba ubah kata kunci pencarian, atau tambahkan arsip baru.','Buat sampul untuk mengelompokkan surat, seperti map arsip fisik.').replace("onclick=\"openForm()\"", "onclick=\"openSampulForm()\"").replace('+ Tambah arsip','+ Tambah sampul');
  }

  const body = letters.map(letter=>`<div class="alpha-group" id="sampul-letter-${letter}">
    <div class="alpha-group-header"><span class="letter">${letter}</span><span class="n">${groups[letter].length} sampul</span></div>
    <div class="sampul-grid">${groups[letter].map(sampulCardHTML).join('')}</div>
  </div>`).join('');

  return addBtn + jump + body;
}

function sampulDetailHTML(sampulId){
  const s = sampulById(sampulId);
  const color = sampulColor(sampulId);
  const list = records.filter(r=>r.sampulId===sampulId);
  const header = `<div class="sampul-detail-header">
    <div class="sampul-spine" style="background:${color};"></div>
    <div class="meta">
      <h3>${escapeHtml(s ? s.nama : 'Sampul')}</h3>
      <div class="desc">${s && s.deskripsi ? escapeHtml(s.deskripsi) : (s && s.kategori ? catLabel(s.kategori) : 'Tanpa kategori terkait')}</div>
    </div>
    <div class="actions">
      <button class="btn-secondary" onclick="openSampulForm(sampulById('${sampulId}'))">Edit sampul</button>
      <button class="btn-primary" onclick="openForm()">+ Tambah surat</button>
    </div>
  </div>`;
  return header + alphaIndexHTML(list);
}

function renderMain(){
  const container = document.getElementById('main-content');

  if(currentView==='sampul-list'){
    document.getElementById('toolbar').classList.remove('hidden');
    document.getElementById('dashboard-stats').classList.add('hidden');
    document.getElementById('status-filter').classList.add('hidden');
    document.getElementById('sort-by').classList.add('hidden');
    document.getElementById('view-toggle-wrap').classList.add('hidden');
    document.getElementById('alpha-sort').classList.remove('hidden');
    container.innerHTML = sampulListHTML();
    return;
  }
  if(currentView==='sampul-detail'){
    document.getElementById('toolbar').classList.remove('hidden');
    document.getElementById('dashboard-stats').classList.add('hidden');
    document.getElementById('status-filter').classList.add('hidden');
    document.getElementById('sort-by').classList.add('hidden');
    document.getElementById('view-toggle-wrap').classList.add('hidden');
    document.getElementById('alpha-sort').classList.remove('hidden');
    container.innerHTML = sampulDetailHTML(currentSampulId);
    return;
  }

  const isAllView = currentView==='all';
  document.getElementById('toolbar').classList.remove('hidden');
  document.getElementById('status-filter').classList.remove('hidden');
  document.getElementById('sort-by').classList.toggle('hidden', isAllView);
  document.getElementById('view-toggle-wrap').classList.toggle('hidden', isAllView);
  document.getElementById('alpha-sort').classList.toggle('hidden', !isAllView);

  if(isAllView){
    const list = getFiltered();
    container.innerHTML = alphaIndexHTML(list);
    return;
  }

  const list = getFiltered();
  if(list.length===0){
    container.innerHTML = displayMode==='grid' ? `<div class="grid">${emptyStateHTML()}</div>` : emptyStateHTML();
  }else{
    container.innerHTML = displayMode==='list' ? listTableHTML(list) : gridTileHTML(list);
  }
  if(currentView==='dashboard') renderDashboardStats();
}

function renderDashboardStats(){
  const total = records.length;
  const aktif = records.filter(r=>r.status==='aktif').length;
  const now = new Date();
  const bulanIni = records.filter(r=>{
    if(!r.tanggal) return false;
    const d = new Date(r.tanggal+'T00:00:00');
    return d.getMonth()===now.getMonth() && d.getFullYear()===now.getFullYear();
  }).length;
  document.getElementById('dashboard-stats').innerHTML = `
    <div class="stat-card"><div class="num">${total}</div><div class="lbl">Total arsip</div></div>
    <div class="stat-card"><div class="num">${aktif}</div><div class="lbl">Status aktif</div></div>
    <div class="stat-card"><div class="num">${bulanIni}</div><div class="lbl">Ditambahkan bulan ini</div></div>
    <div class="stat-card"><div class="num">${CATEGORIES.length}</div><div class="lbl">Kategori arsip</div></div>
  `;
}

function refreshCounters(){
  document.getElementById('count-all').textContent = records.length;
  document.getElementById('count-sampul').textContent = sampulList.length;
  const max = Math.max(records.length, 20);
  document.getElementById('storage-fill').style.width = Math.min(100, (records.length/max)*100) + '%';
  document.getElementById('storage-text').textContent = records.length + ' dokumen';
}

function openForm(record){
  editingId = record ? record.id : null;
  pendingFile = null;
  document.getElementById('form-title').textContent = record ? 'Edit surat' : 'Tambah surat';
  document.getElementById('f-id').value = record ? record.id : '';
  document.getElementById('f-nomor').value = record ? record.nomor : '';
  document.getElementById('f-judul').value = record ? record.judul : '';
  document.getElementById('f-kategori').value = record ? record.kategori : (currentCategory || CATEGORIES[0].id);
  document.getElementById('f-arah').value = record ? (record.arah || '') : '';
  document.getElementById('f-tanggal').value = record ? record.tanggal : '';
  document.getElementById('f-personel').value = record ? record.personel : '';
  rebuildStatusOptions(record ? record.status : defaultStatusForCategory(document.getElementById('f-kategori').value));
  document.getElementById('f-keterangan').value = record ? record.keterangan : '';
  document.getElementById('f-tenggat').value = record ? (record.tenggat || '') : '';
  document.getElementById('tenggat-field').classList.toggle('hidden', !categoryHasDeadline(document.getElementById('f-kategori').value));
  document.getElementById('arah-field').classList.toggle('hidden', !categoryHasArah(document.getElementById('f-kategori').value));
  populateFormSampulSelect(record ? record.sampulId : (currentView==='sampul-detail' ? currentSampulId : ''));
  document.getElementById('btn-delete').classList.toggle('hidden', !record);
  document.getElementById('f-file').value = '';
  document.getElementById('file-chip').classList.add('hidden');

  if(STANDALONE){
    document.getElementById('form-sub').textContent = 'Unggah berkas hasil scan (PDF/JPG/PNG), lalu lengkapi nama, kategori, nomor, tanggal, dan status dokumennya.';
    document.getElementById('dropzone').classList.remove('hidden');
    document.getElementById('upload-note').textContent = record && record.hasFile ? '' : 'Berkas tersimpan di penyimpanan browser komputer ini (IndexedDB).';
    if(record && record.hasFile){
      showFileChip(record.fileName, record.fileSize);
    }
  }else{
    // Berjalan sebagai artifact Claude: penyimpanan berkas tidak didukung.
    document.getElementById('form-sub').textContent = 'Lengkapi nama, kategori, nomor, tanggal, dan status surat. Unggah berkas hanya tersedia saat aplikasi dijalankan mandiri (mis. di Laragon).';
    document.getElementById('dropzone').classList.add('hidden');
    document.getElementById('upload-note').textContent = '';
  }

  // Bagian "Detail tambahan" sedang disembunyikan sesuai permintaan.
  // Untuk mengaktifkan lagi: hapus baris komentar di bawah, dan hapus
  // class "hidden" dari #detail-toggle di index.html.
  // const hasExtra = !!(record && (record.nomor || record.personel || record.keterangan || record.sampulId || (record.status && record.status!=='aktif')));
  // setFormDetailOpen(hasExtra);

  document.getElementById('form-overlay').classList.add('show');
  setTimeout(()=>document.getElementById('f-judul').focus(), 50);
}
function closeForm(){ document.getElementById('form-overlay').classList.remove('show'); }

function setFormDetailOpen(open){
  document.getElementById('detail-extra').classList.toggle('hidden', !open);
  document.getElementById('detail-toggle-label').textContent = open ? '− Sembunyikan detail tambahan' : '+ Detail tambahan (opsional)';
}
function toggleFormDetail(){
  const isHidden = document.getElementById('detail-extra').classList.contains('hidden');
  setFormDetailOpen(isHidden);
}

const STATUS_LABELS = {aktif:'Aktif', selesai:'Diarsipkan', arsip:'Selesai'};
const ARAH_LABELS = {masuk:'Surat Masuk', keluar:'Surat Keluar'};
const ARAH_ICON = {masuk:'&#8600;', keluar:'&#8599;'};

// Menentukan pilihan status yang relevan untuk sebuah kategori:
// - kategori berdefault "selesai" atau "arsip" -> cuma satu pilihan tetap (dikunci)
// - kategori berdefault "aktif" -> hanya boleh Aktif / Selesai (tanpa Diarsipkan)
function statusOptionsForCategory(kategoriId){
  const def = defaultStatusForCategory(kategoriId);
  if(def === 'aktif') return ['aktif', 'arsip'];
  if(def === 'selesai') return ['selesai'];
  if(def === 'arsip') return ['arsip'];
  return ['aktif', 'selesai', 'arsip'];
}

function rebuildStatusOptions(preferredValue){
  const kategoriId = document.getElementById('f-kategori').value;
  const options = statusOptionsForCategory(kategoriId);
  const sel = document.getElementById('f-status');
  sel.innerHTML = options.map(o=>`<option value="${o}">${STATUS_LABELS[o]}</option>`).join('');
  sel.value = options.includes(preferredValue) ? preferredValue : options[0];
  const locked = options.length <= 1;
  sel.disabled = locked;
  sel.classList.toggle('status-locked', locked);
  document.getElementById('f-status-note').textContent = locked
    ? 'Kategori ini selalu berstatus "' + STATUS_LABELS[options[0]] + '", tidak ada pilihan lain.'
    : 'Terisi otomatis berdasarkan kategori, bisa diubah manual bila perlu.';
}

function applyDefaultStatus(){
  const kategoriId = document.getElementById('f-kategori').value;
  rebuildStatusOptions(defaultStatusForCategory(kategoriId));
}

function onFormKategoriChange(){
  applyDefaultStatus();
  const kategoriId = document.getElementById('f-kategori').value;
  const field = document.getElementById('tenggat-field');
  const hasDeadline = categoryHasDeadline(kategoriId);
  field.classList.toggle('hidden', !hasDeadline);
  if(!hasDeadline){
    document.getElementById('f-tenggat').value = '';
  }

  const arahField = document.getElementById('arah-field');
  const hasArah = categoryHasArah(kategoriId);
  arahField.classList.toggle('hidden', !hasArah);
  if(!hasArah){
    document.getElementById('f-arah').value = '';
  }
}

function showFileChip(name, size){
  document.getElementById('file-chip').classList.remove('hidden');
  document.getElementById('file-chip-name').textContent = name + (size ? ' · ' + formatFileSize(size) : '');
}
function handleFileSelect(evt){
  const file = evt.target.files && evt.target.files[0];
  if(!file) return;
  const maxSize = 20*1024*1024;
  if(file.size > maxSize){
    showToast('Ukuran berkas maksimal 20 MB.');
    evt.target.value = '';
    return;
  }
  pendingFile = file;
  showFileChip(file.name, file.size);
  const judulField = document.getElementById('f-judul');
  if(!judulField.value.trim()){
    judulField.value = file.name.replace(/\.[^/.]+$/, '');
  }
}
function removeSelectedFile(){
  pendingFile = null;
  document.getElementById('f-file').value = '';
  document.getElementById('file-chip').classList.add('hidden');
}

const dropzoneEl = document.getElementById('dropzone');
if(dropzoneEl){
  ['dragover','dragenter'].forEach(evt=>{
    dropzoneEl.addEventListener(evt, e=>{ e.preventDefault(); dropzoneEl.classList.add('dragover'); });
  });
  ['dragleave','drop'].forEach(evt=>{
    dropzoneEl.addEventListener(evt, e=>{ e.preventDefault(); dropzoneEl.classList.remove('dragover'); });
  });
  dropzoneEl.addEventListener('drop', e=>{
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if(!file) return;
    document.getElementById('f-file').files = e.dataTransfer.files;
    handleFileSelect({target:{files:e.dataTransfer.files}});
  });
}

async function viewAttachedFile(id){
  const rec = await getFileBlob(id);
  if(!rec || !rec.blob){ showToast('Berkas tidak ditemukan.'); return; }
  const url = URL.createObjectURL(rec.blob);
  window.open(url, '_blank');
}

async function saveRecord(){
  const judul = document.getElementById('f-judul').value.trim();
  if(!judul){ showToast('Nama surat wajib diisi.'); return; }
  const today = new Date().toISOString().slice(0,10);
  const id = editingId || ('arsip-' + Date.now() + '-' + Math.floor(Math.random()*1000));
  const existing = editingId ? records.find(r=>r.id===editingId) : null;
  const data = {
    id,
    nomor: document.getElementById('f-nomor').value.trim(),
    judul,
    kategori: document.getElementById('f-kategori').value,
    arah: categoryHasArah(document.getElementById('f-kategori').value) ? (document.getElementById('f-arah').value || null) : 'masuk',
    tanggal: document.getElementById('f-tanggal').value || today,
    personel: document.getElementById('f-personel').value.trim(),
    status: document.getElementById('f-status').value,
    keterangan: document.getElementById('f-keterangan').value.trim(),
    tenggat: categoryHasDeadline(document.getElementById('f-kategori').value) ? (document.getElementById('f-tenggat').value || null) : null,
    sampulId: document.getElementById('f-sampul').value || null,
    hasFile: pendingFile ? true : !!(existing && existing.hasFile),
    fileName: pendingFile ? pendingFile.name : (existing ? existing.fileName : null),
    fileSize: pendingFile ? pendingFile.size : (existing ? existing.fileSize : null),
    dibuatPada: existing ? existing.dibuatPada : Date.now()
  };
  if(pendingFile && STANDALONE){
    await saveFileBlob(id, pendingFile);
  }
  if(editingId) records = records.map(r=> r.id===editingId ? data : r);
  else records.push(data);
  await persist();
  buildCatNav();
  refreshCounters();
  closeForm();
  showToast(editingId ? 'Surat diperbarui.' : 'Surat ditambahkan.');
  renderMain();
}

async function deleteRecord(){
  if(!editingId) return;
  if(!confirm('Hapus dokumen arsip ini? Tindakan tidak dapat dibatalkan.')) return;
  await deleteFileBlob(editingId);
  records = records.filter(r=>r.id!==editingId);
  await persist();
  buildCatNav();
  refreshCounters();
  closeForm();
  showToast('Arsip dihapus.');
  renderMain();
}

function openDetail(id){
  const r = records.find(x=>x.id===id);
  if(!r) return;
  detailId = id;
  const sm = statusMeta(r.status);
  document.getElementById('d-status').className = 'pill ' + sm.cls;
  document.getElementById('d-status').textContent = sm.label;
  document.getElementById('d-judul').textContent = r.judul;
  document.getElementById('d-nomor').textContent = r.nomor || 'Tanpa nomor dokumen';
  document.getElementById('d-kategori').textContent = catLabel(r.kategori);
  if(r.arah){
    document.getElementById('d-arah-row').classList.remove('hidden');
    document.getElementById('d-arah').textContent = ARAH_LABELS[r.arah] || r.arah;
  }else{
    document.getElementById('d-arah-row').classList.add('hidden');
  }
  document.getElementById('d-tanggal').textContent = formatTanggal(r.tanggal);
  if(r.tenggat){
    document.getElementById('d-tenggat-row').classList.remove('hidden');
    document.getElementById('d-tenggat').textContent = formatTanggal(r.tenggat);
  }else{
    document.getElementById('d-tenggat-row').classList.add('hidden');
  }
  document.getElementById('d-personel').textContent = r.personel || '-';
  document.getElementById('d-sampul').textContent = r.sampulId ? sampulName(r.sampulId) : 'Tanpa sampul';
  document.getElementById('d-keterangan').textContent = r.keterangan || '-';
  if(r.hasFile && STANDALONE){
    document.getElementById('d-file-chip').classList.remove('hidden');
    document.getElementById('d-file-name').textContent = (r.fileName||'Berkas') + (r.fileSize ? ' · ' + formatFileSize(r.fileSize) : '');
  }else{
    document.getElementById('d-file-chip').classList.add('hidden');
  }
  document.getElementById('d-edit-btn').onclick = ()=>{ closeDetail(); openForm(r); };
  document.getElementById('detail-overlay').classList.add('show');
}
function closeDetail(){ document.getElementById('detail-overlay').classList.remove('show'); }

let contextMenuTargetId = null;
function showContextMenu(evt, id){
  evt.preventDefault();
  evt.stopPropagation();
  contextMenuTargetId = id;
  const menu = document.getElementById('context-menu');
  const x = Math.min(evt.clientX, window.innerWidth - 200);
  const y = Math.min(evt.clientY, window.innerHeight - 160);
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  menu.classList.add('show');
}
function hideContextMenu(){
  document.getElementById('context-menu').classList.remove('show');
  contextMenuTargetId = null;
}
document.addEventListener('click', hideContextMenu);
document.addEventListener('contextmenu', e=>{
  if(!e.target.closest('tr') && !e.target.closest('.tile')) hideContextMenu();
});
document.getElementById('ctx-open').addEventListener('click', ()=>{
  if(contextMenuTargetId) openDetail(contextMenuTargetId);
  hideContextMenu();
});
document.getElementById('ctx-edit').addEventListener('click', ()=>{
  const r = records.find(x=>x.id===contextMenuTargetId);
  if(r) openForm(r);
  hideContextMenu();
});
document.getElementById('ctx-delete').addEventListener('click', async ()=>{
  const id = contextMenuTargetId;
  hideContextMenu();
  if(!id) return;
  if(!confirm('Hapus dokumen arsip ini? Tindakan tidak dapat dibatalkan.')) return;
  await deleteFileBlob(id);
  records = records.filter(r=>r.id!==id);
  await persist();
  buildCatNav();
  refreshCounters();
  showToast('Arsip dihapus.');
  renderMain();
});

function openSampulForm(sampul){
  editingSampulId = sampul ? sampul.id : null;
  document.getElementById('sampul-form-title').textContent = sampul ? 'Edit sampul' : 'Tambah sampul baru';
  document.getElementById('s-id').value = sampul ? sampul.id : '';
  document.getElementById('s-nama').value = sampul ? sampul.nama : '';
  document.getElementById('s-kategori').value = sampul ? (sampul.kategori||'') : (currentCategory || '');
  document.getElementById('s-deskripsi').value = sampul ? (sampul.deskripsi||'') : '';
  document.getElementById('s-btn-delete').classList.toggle('hidden', !sampul);
  document.getElementById('sampul-form-overlay').classList.add('show');
}
function closeSampulForm(){ document.getElementById('sampul-form-overlay').classList.remove('show'); }

async function saveSampul(){
  const nama = document.getElementById('s-nama').value.trim();
  if(!nama){ showToast('Nama sampul wajib diisi.'); return; }
  const data = {
    id: editingSampulId || ('sampul-' + Date.now() + '-' + Math.floor(Math.random()*1000)),
    nama,
    kategori: document.getElementById('s-kategori').value || null,
    deskripsi: document.getElementById('s-deskripsi').value.trim(),
    dibuatPada: editingSampulId ? (sampulList.find(s=>s.id===editingSampulId)?.dibuatPada || Date.now()) : Date.now()
  };
  if(editingSampulId) sampulList = sampulList.map(s=> s.id===editingSampulId ? data : s);
  else sampulList.push(data);
  await persistSampul();
  refreshCounters();
  closeSampulForm();
  showToast(editingSampulId ? 'Sampul diperbarui.' : 'Sampul baru ditambahkan.');
  renderMain();
}

async function deleteSampul(){
  if(!editingSampulId) return;
  if(!confirm('Hapus sampul ini? Surat di dalamnya tidak ikut terhapus, hanya menjadi tanpa sampul.')) return;
  sampulList = sampulList.filter(s=>s.id!==editingSampulId);
  records = records.map(r=> r.sampulId===editingSampulId ? {...r, sampulId:null} : r);
  await persistSampul();
  await persist();
  refreshCounters();
  closeSampulForm();
  showToast('Sampul dihapus.');
  if(currentView==='sampul-detail') setView('sampul-list');
  else renderMain();
}

document.getElementById('sampul-form-overlay').addEventListener('click', e=>{ if(e.target.id==='sampul-form-overlay') closeSampulForm(); });
document.getElementById('form-overlay').addEventListener('click', e=>{ if(e.target.id==='form-overlay') closeForm(); });
document.getElementById('detail-overlay').addEventListener('click', e=>{ if(e.target.id==='detail-overlay') closeDetail(); });

async function init(){
  buildFormCategorySelect();
  await loadRecords();
  await loadSampul();
  await checkExpiredRecords();
  await backfillMissingArah();
  buildCatNav();
  refreshCounters();
  setView('dashboard');
}

// Mengisi arah surat yang masih kosong untuk data lama, khusus kategori
// yang field arahnya disembunyikan (dianggap Surat Masuk secara default).
async function backfillMissingArah(){
  let changed = false;
  records = records.map(r=>{
    if(!r.arah && !categoryHasArah(r.kategori)){
      changed = true;
      return {...r, arah:'masuk'};
    }
    return r;
  });
  if(changed) await persist();
}

// Memindahkan surat berstatus "Aktif" ke "Selesai" secara otomatis kalau
// tanggal tenggatnya sudah lewat. Dijalankan sekali tiap aplikasi dibuka.
async function checkExpiredRecords(){
  const today = new Date().toISOString().slice(0,10);
  let changedCount = 0;
  records = records.map(r=>{
    if(r.tenggat && r.status === 'aktif' && r.tenggat < today){
      changedCount++;
      return {...r, status:'arsip'};
    }
    return r;
  });
  if(changedCount > 0){
    await persist();
    showToast(changedCount === 1
      ? '1 surat otomatis dipindah ke status Selesai karena tenggatnya sudah lewat.'
      : changedCount + ' surat otomatis dipindah ke status Selesai karena tenggatnya sudah lewat.');
  }
}

// ===== Login Google (asli, lewat Google Identity Services) =====
// Isi Client ID Anda di sini. Dapatkan dari Google Cloud Console:
// console.cloud.google.com > APIs & Services > Credentials > Create OAuth
// client ID (Web application), lalu daftarkan alamat aplikasi Anda
// (mis. http://biddokkes-arsip.test atau http://localhost) di
// "Authorized JavaScript origins". Lihat README.md untuk panduan lengkap.
const GOOGLE_CLIENT_ID = 'GANTI_DENGAN_CLIENT_ID_ANDA.apps.googleusercontent.com';
let currentUser = null;

function decodeJwt(token){
  try{
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g,'+').replace(/_/g,'/');
    const json = decodeURIComponent(atob(base64).split('').map(c=>'%'+('00'+c.charCodeAt(0).toString(16)).slice(-2)).join(''));
    return JSON.parse(json);
  }catch(e){ return null; }
}

function initGoogleSignIn(){
  const configured = GOOGLE_CLIENT_ID && !GOOGLE_CLIENT_ID.startsWith('GANTI_DENGAN');
  const container = document.getElementById('google-signin-container');
  const fallbackBtn = document.getElementById('google-login-btn');
  const note = document.getElementById('login-note');

  if(configured && typeof google !== 'undefined' && google.accounts && google.accounts.id){
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleCredentialResponse
    });
    google.accounts.id.renderButton(container, {
      theme:'outline', size:'large', shape:'pill', text:'continue_with', width:300
    });
    container.classList.remove('hidden');
    fallbackBtn.classList.add('hidden');
    note.textContent = 'Masuk memakai Akun Google sungguhan lewat Google Identity Services.';
  }else{
    // Client ID belum diatur: tampilkan tombol simulasi sebagai cadangan.
    container.classList.add('hidden');
    fallbackBtn.classList.remove('hidden');
    note.textContent = 'Client ID Google belum diatur, jadi tombol di atas memakai tampilan simulasi. Lihat README.md untuk mengaktifkan login Google sungguhan.';
  }
}

function handleGoogleCredentialResponse(response){
  const payload = decodeJwt(response.credential);
  if(payload){
    currentUser = {
      name: payload.name || 'Admin Biddokkes',
      email: payload.email || '',
      picture: payload.picture || ''
    };
    applyCurrentUserToUI();
  }
  proceedToApp();
}

function applyCurrentUserToUI(){
  if(!currentUser) return;
  const initials = currentUser.name.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase() || 'BD';
  document.querySelectorAll('.acc-name, #am-name').forEach(el=> el.textContent = currentUser.name);
  document.querySelectorAll('.acc-email, #am-email').forEach(el=> el.textContent = currentUser.email);
  document.querySelectorAll('.acc-avatar-lg, .acc-avatar-xl, #avatar-btn').forEach(el=>{
    el.textContent = initials;
    if(currentUser.picture){
      el.style.backgroundImage = `url('${currentUser.picture}')`;
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      el.textContent = '';
    }
  });
}

async function proceedToApp(){
  document.getElementById('login-screen').classList.remove('show');
  document.getElementById('app-root').classList.remove('hidden');
  await init();
}

// ===== Alur splash logo -> login -> aplikasi =====
function startSplashSequence(){
  initGoogleSignIn();
  setTimeout(()=>{
    const splash = document.getElementById('splash-screen');
    splash.classList.add('fade-out');
    setTimeout(()=>{
      splash.style.display = 'none';
      document.getElementById('login-screen').classList.add('show');
    }, 1100);
  }, 3000);
}

// Tombol cadangan (dipakai hanya bila Client ID Google belum diatur).
function handleGoogleLogin(){
  const btn = document.getElementById('google-login-btn');
  const label = document.getElementById('google-login-label');
  if(btn.disabled) return;
  btn.disabled = true;
  label.textContent = 'Memverifikasi...';
  setTimeout(async ()=>{
    label.textContent = 'Lanjutkan dengan Akun Google';
    btn.disabled = false;
    await proceedToApp();
  }, 900);
}

function handleLogout(){
  document.getElementById('account-dropdown').classList.remove('show');
  document.getElementById('account-modal-overlay').classList.remove('show');
  document.getElementById('app-root').classList.add('hidden');
  document.getElementById('login-screen').classList.add('show');
  if(typeof google !== 'undefined' && google.accounts && google.accounts.id){
    google.accounts.id.disableAutoSelect();
  }
}

// ===== Dropdown & modal akun =====
function toggleAccountDropdown(evt){
  evt.stopPropagation();
  document.getElementById('account-dropdown').classList.toggle('show');
}
document.addEventListener('click', ()=>{
  document.getElementById('account-dropdown').classList.remove('show');
});
function openAccountModal(){
  document.getElementById('account-dropdown').classList.remove('show');
  document.getElementById('account-modal-overlay').classList.add('show');
}
function closeAccountModal(){ document.getElementById('account-modal-overlay').classList.remove('show'); }
function setAccountTab(tab){
  document.querySelectorAll('.acc-tab').forEach(t=>t.classList.toggle('active', t.dataset.tab===tab));
  ['info','keamanan','privasi'].forEach(t=>{
    document.getElementById('acc-panel-'+t).classList.toggle('hidden', t!==tab);
  });
}
const accountModalOverlayEl = document.getElementById('account-modal-overlay');
if(accountModalOverlayEl) accountModalOverlayEl.addEventListener('click', e=>{ if(e.target.id==='account-modal-overlay') closeAccountModal(); });

// ===== Bantuan =====
function openHelp(){ document.getElementById('help-overlay').classList.add('show'); }
function closeHelp(){ document.getElementById('help-overlay').classList.remove('show'); }
const helpOverlayEl = document.getElementById('help-overlay');
if(helpOverlayEl) helpOverlayEl.addEventListener('click', e=>{ if(e.target.id==='help-overlay') closeHelp(); });

// ===== Pengaturan: ringkasan, ekspor, impor =====
function openSettings(){
  document.getElementById('set-total-arsip').textContent = records.length;
  document.getElementById('set-total-sampul').textContent = sampulList.length;
  document.getElementById('set-total-kategori').textContent = CATEGORIES.length + ' kategori';
  document.getElementById('settings-overlay').classList.add('show');
}
function closeSettings(){ document.getElementById('settings-overlay').classList.remove('show'); }
const settingsOverlayEl = document.getElementById('settings-overlay');
if(settingsOverlayEl) settingsOverlayEl.addEventListener('click', e=>{ if(e.target.id==='settings-overlay') closeSettings(); });

function exportData(){
  const payload = { records, sampulList, diekspor_pada: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'arsip-biddokkes-backup.json';
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(()=> URL.revokeObjectURL(url), 1000);
  showToast('Data berhasil diekspor — cek folder Downloads browser Anda.');
}

async function importData(evt){
  const file = evt.target.files && evt.target.files[0];
  if(!file) return;
  try{
    const text = await file.text();
    const data = JSON.parse(text);
    if(!confirm('Impor akan menimpa data arsip dan sampul yang ada saat ini. Lanjutkan?')){
      evt.target.value = '';
      return;
    }
    records = Array.isArray(data.records) ? data.records : records;
    sampulList = Array.isArray(data.sampulList) ? data.sampulList : sampulList;
    await persist();
    await persistSampul();
    buildCatNav();
    refreshCounters();
    document.getElementById('set-total-arsip').textContent = records.length;
    document.getElementById('set-total-sampul').textContent = sampulList.length;
    renderMain();
    showToast('Data berhasil diimpor.');
  }catch(e){
    showToast('Gagal membaca berkas. Pastikan formatnya sesuai hasil ekspor.');
  }
  evt.target.value = '';
}

startSplashSequence();
