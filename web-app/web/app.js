// Plan B app: poll JSON under /d/{DATA_PATH}/
const DATA_PATH = localStorage.getItem('data_path') || (location.hash.match(/d=([^&]+)/) || [])[1];
if (DATA_PATH) localStorage.setItem('data_path', DATA_PATH);
const BASE = DATA_PATH ? `/d/${DATA_PATH}/` : '/d/';

let state = {};
async function poll() {
  try {
    const r = await fetch(BASE + 'state.json');
    if (r.ok) state = await r.json();
    render();
  } catch (e) {
    showError();
  }
}
function render() {
  const content = document.getElementById('content');
  const mode = state.mode || 'PAPER';
  content.innerHTML = `
    <div class="navbar-row">
      <div class="odometer">${(state.balance || 200).toFixed(2)}</div>
      ${mode === 'PAPER' ? '<span class="paper">PAPER</span>' : ''}
    </div>
    <div style="color:var(--secondary);margin-bottom:16px;">+${(state.today_pct || 0).toFixed(2)}% today</div>
    <canvas id="chart" style="width:100%;height:180px;"></canvas>
    <div style="margin-top:24px;font-size:17px;">Agents · 5 running</div>
    <div class="card">Scanner · Auditor · Analyst · Executor · Risk</div>
    <div>Activity · See all</div>
  `;
  // draw chart if points
  const canvas = document.getElementById('chart');
  if (canvas && window.drawLine) drawLine(canvas, [200, 210, 205], '#00d35a');
  renderTabs();
}
function renderTabs() {
  document.getElementById('tabbar').innerHTML = `
    <div class="tab active">Home</div>
    <div class="tab">Agents</div>
    <div class="tab">Activity</div>
    <div class="tab">Account</div>
  `;
}
function showError() {
  document.getElementById('content').innerHTML = '<div class="error">Desk offline · retrying in 5s · last update --</div>';
}
setInterval(poll, 5000);
poll();
renderTabs();
