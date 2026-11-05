
// Background Service Worker - does real fetch with host_permissions bypassing CORS
function classifyStatus(status) {
  if (status === 0) return { label: 'Network Error', cat: 'error', color: '#1f1f1f' };
  if (status >= 100 && status < 200) return { label: 'Informational', cat: '1xx', color: '#3b82f6' };
  if (status >= 200 && status < 300) {
    const map = {200:'OK',201:'Created',202:'Accepted',204:'No Content',206:'Partial Content'};
    return { label: map[status] || 'Success', cat: '2xx', color: '#16a34a' };
  }
  if (status >= 300 && status < 400) {
    const map = {
      300:'Multiple Choices',
      301:'Moved Permanently',
      302:'Found (Temporary)',
      303:'See Other',
      304:'Not Modified',
      305:'Use Proxy',
      307:'Temporary Redirect',
      308:'Permanent Redirect'
    };
    return { label: map[status] || 'Redirect', cat: '3xx', color: '#f59e0b' };
  }
  if (status >= 400 && status < 500) {
    const map = {
      400:'Bad Request',401:'Unauthorized',402:'Payment Required',403:'Forbidden',
      404:'Not Found',405:'Method Not Allowed',408:'Request Timeout',
      410:'Gone',418:"I'm a Teapot",429:'Too Many Requests',451:'Legal Reasons'
    };
    return { label: map[status] || 'Client Error', cat: '4xx', color: '#ef4444' };
  }
  if (status >= 500) {
    const map = {
      500:'Internal Server Error',501:'Not Implemented',502:'Bad Gateway',
      503:'Service Unavailable',504:'Gateway Timeout'
    };
    return { label: map[status] || 'Server Error', cat: '5xx', color: '#991b1b' };
  }
  return { label: 'Unknown', cat: 'unknown', color: '#6b7280' };
}

async function checkChain(startUrl) {
  const chain = [];
  let current = startUrl;
  const visited = new Set();
  
  for (let hop = 0; hop < 10; hop++) {
    if (visited.has(current)) {
      chain.push({ url: current, status: 0, statusText: 'Loop detected', type: 'Loop', location: null, time: 0, error: true });
      break;
    }
    visited.add(current);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const t0 = Date.now();
    try {
      // Manual redirect so we can read Location header
      const res = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        cache: 'no-store'
      });
      clearTimeout(timeout);
      const duration = Date.now() - t0;
      // Chrome extensions with <all_urls> can read headers even cross-origin
      const location = res.headers.get('Location') || res.headers.get('location');
      const status = res.status;
      const statusText = res.statusText || '';
      const info = classifyStatus(status);

      chain.push({
        url: current,
        status,
        statusText,
        type: info.label,
        cat: info.cat,
        location: location,
        time: duration
      });

      // If redirect, follow it
      if (status >= 300 && status < 400 && location) {
        try {
          current = new URL(location, current).href;
          continue;
        } catch (e) {
          break;
        }
      } else {
        break; // not a redirect, chain ends
      }
    } catch (err) {
      clearTimeout(timeout);
      const duration = Date.now() - t0;
      // Network error / CORS / timeout / abort
      chain.push({
        url: current,
        status: 0,
        statusText: err.name === 'AbortError' ? 'Timeout (15s)' : err.message,
        type: 'Network Error',
        cat: 'error',
        location: null,
        time: duration,
        error: true
      });
      break;
    }
  }
  return chain;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'CHECK_URL') {
    checkChain(msg.url).then(chain => {
      sendResponse({ ok: true, chain });
    }).catch(e => {
      sendResponse({ ok: false, error: e.message });
    });
    return true; // async
  }
});
