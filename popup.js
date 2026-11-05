
const urlInput = document.getElementById('urlInput');
const checkBtn = document.getElementById('checkBtn');
const clearBtn = document.getElementById('clearBtn');
const tbody = document.getElementById('tbody');
const progress = document.getElementById('progress');
const progressBar = document.getElementById('progressBar');
const fileInput = document.getElementById('fileInput');

let results = [];
let currentFilter = 'all';

function normalizeUrl(u) {
  u = u.trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try { new URL(u); return u; } catch { return null; }
}

function badgeClass(cat) {
  if (cat === '2xx') return 'badge-2xx';
  if (cat === '3xx') return 'badge-3xx';
  if (cat === '4xx') return 'badge-4xx';
  if (cat === '5xx') return 'badge-5xx';
  return 'badge-error';
}

function render() {
  const filtered = results.filter(r => {
    if (currentFilter === 'all') return true;
    return r.last.cat === currentFilter;
  });

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">${results.length ? 'No results for this filter' : 'No data yet'}</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((r, idx) => {
    const first = r.chain[0];
    const last = r.last;
    const chainHtml = r.chain.map((c,i) => {
      const arrow = i===0 ? '' : ' → ';
      return `${arrow}<span>${c.status || 'ERR'}</span> ${c.url.substring(0,60)}`;
    }).join('<br>');
    
    return `<tr>
      <td>${r.index}</td>
      <td class="url-cell"><a href="${r.original}" target="_blank">${r.original}</a></td>
      <td><span class="badge ${badgeClass(last.cat)}">${last.status || 'ERR'}</span></td>
      <td>${last.type}<div style="font-size:10px;color:#9ca3af">${last.cat}</div></td>
      <td>
        <div class="final-url"><a href="${last.url}" target="_blank">${last.url}</a></div>
        <div class="chain">${r.chain.length>1 ? chainHtml : (first.location ? '↳ '+first.location : '')}</div>
        <div class="chain">Hops: ${r.chain.length}</div>
      </td>
      <td class="time">${last.time}ms</td>
    </tr>`;
  }).join('');
}

function updateStats() {
  document.getElementById('sTotal').textContent = results.length;
  document.getElementById('s2xx').textContent = results.filter(r=>r.last.cat==='2xx').length;
  document.getElementById('s3xx').textContent = results.filter(r=>r.last.cat==='3xx').length;
  document.getElementById('s4xx').textContent = results.filter(r=>r.last.cat==='4xx').length;
  document.getElementById('s5xx').textContent = results.filter(r=>r.last.cat==='5xx').length;
}

async function checkUrlWithBackground(url) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'CHECK_URL', url }, (res) => {
      if (chrome.runtime.lastError) {
        resolve({ error: chrome.runtime.lastError.message });
      } else {
        resolve(res);
      }
    });
  });
}

async function runChecks(urls) {
  results = [];
  checkBtn.disabled = true;
  progress.style.display = 'block';
  tbody.innerHTML = '';
  
  const concurrency = 5;
  let completed = 0;

  // queue
  const queue = urls.map((u,i) => ({ url: u, index: i+1 }));

  async function worker() {
    while (queue.length) {
      const item = queue.shift();
      if (!item) break;
      const res = await checkUrlWithBackground(item.url);
      const chain = res && res.chain ? res.chain : [{ url: item.url, status:0, type:'Network Error', cat:'error', time:0, statusText: res?.error || 'Failed' }];
      const last = chain[chain.length-1];
      results.push({ original: item.url, index: item.index, chain, last });
      completed++;
      const pct = Math.round((completed / urls.length)*100);
      progressBar.style.width = pct + '%';
      updateStats();
      render();
    }
  }

  const workers = Array.from({length: concurrency}, () => worker());
  await Promise.all(workers);

  progress.style.display = 'none';
  checkBtn.disabled = false;
}

checkBtn.addEventListener('click', () => {
  const lines = urlInput.value.split('\n').map(s=>s.trim()).filter(Boolean);
  if (!lines.length) return alert('Paste at least 1 URL');
  if (lines.length > 200) {
    if (!confirm(`You pasted ${lines.length} URLs. Limit is 200. Only first 200 will be checked. Continue?`)) return;
  }
  const normalized = [];
  const invalid = [];
  for (const line of lines.slice(0,200)) {
    const n = normalizeUrl(line);
    if (n) normalized.push(n); else invalid.push(line);
  }
  if (invalid.length) alert(`Skipped ${invalid.length} invalid URLs:\n${invalid.slice(0,5).join('\n')}`);
  if (!normalized.length) return alert('No valid URLs');
  runChecks(normalized);
});

clearBtn.addEventListener('click', () => {
  urlInput.value = '';
  results = [];
  tbody.innerHTML = '<tr><td colspan="6" class="empty">Cleared.</td></tr>';
  updateStats(); render();
  progress.style.display='none'; progressBar.style.width='0%';
});

document.getElementById('filters').addEventListener('click', (e) => {
  if (!e.target.classList.contains('filter')) return;
  document.querySelectorAll('.filter').forEach(f=>f.classList.remove('active'));
  e.target.classList.add('active');
  currentFilter = e.target.dataset.f;
  render();
});

document.getElementById('exportCsv').addEventListener('click', () => {
  if (!results.length) return alert('No data');
  const rows = [['#','Original URL','Final URL','Status','Type','Category','Hops','Time(ms)','Full Chain']];
  results.forEach(r=>{
    rows.push([
      r.index,
      `"${r.original.replace(/"/g,'""')}"`,
      `"${r.last.url.replace(/"/g,'""')}"`,
      r.last.status,
      `"${r.last.type}"`,
      r.last.cat,
      r.chain.length,
      r.last.time,
      `"${r.chain.map(c=>`${c.status} ${c.url}`).join(' -> ').replace(/"/g,'""')}"`
    ]);
  });
  const csv = rows.map(r=>r.join(',')).join('\n');
  download(csv, 'status-codes.csv', 'text/csv');
});

document.getElementById('exportJson').addEventListener('click', () => {
  if (!results.length) return alert('No data');
  download(JSON.stringify(results, null, 2), 'status-codes.json', 'application/json');
});

function download(content, name, type) {
  const blob = new Blob([content], {type});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    urlInput.value = reader.result;
  };
  reader.readAsText(file);
});
