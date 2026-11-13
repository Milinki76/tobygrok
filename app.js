const DATA_PATH = localStorage.getItem('data_path') || (location.hash.match(/d=([^&]+)/) || [])[1];
if (DATA_PATH) localStorage.setItem('data_path', DATA_PATH);
const BASE = DATA_PATH ? `d/${DATA_PATH}/` : 'd/';

let state = { balance: 200, today_pct: 0, mode: 'PAPER' };
let currentTab = 'home';

async function poll() {
  try {
    const r = await fetch(BASE + 'state.json');
    if (r.ok) state = await r.json();
  } catch (e) {}
  render();
}

function render() {
  const content = document.getElementById('content');
  const mode = state.mode || 'PAPER';
  const bal = (state.balance || 200).toFixed(2);

  if (currentTab === 'home') {
    content.innerHTML = `
      <div style="display:flex; align-items:baseline; margin-bottom:4px;">
        <div class="odometer">${bal}</div>
        ${mode === 'PAPER' ? '<span class="paper">PAPER</span>' : ''}
      </div>
      <div style="color:var(--secondary); font-size:15px; margin-bottom:20px;">+${(state.today_pct || 0).toFixed(2)}% today</div>
      <canvas id="chart" style="width:100%; height:160px; display:block; margin-bottom:20px;"></canvas>
      
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <div style="font-size:17px; font-weight:600;">Desk · 5 agents</div>
          <div style="color:var(--secondary); font-size:13px;">0 scanned · 0 traded</div>
        </div>
        ${agentRow('🔍', '#64d2ff', 'Scanner', 'Listening for graduations', '0 pools')}
        ${agentRow('🛡️', '#ff9f0a', 'Auditor', 'No coin taken apart yet', '0 rejected')}
        ${agentRow('⭐', '#ffd60a', 'Analyst', 'Scoring', '0 scored')}
        ${agentRow('⚡', '#00d35a', 'Executor', 'N trades', '0% of stack')}
        ${agentRow('🎯', '#ff6b9a', 'Risk', 'Guarding', 'stop -6%')}
      </div>
      
      <div style="font-size:17px; font-weight:600; margin:16px 0 8px;">Activity</div>
      <div style="color:var(--secondary); text-align:center; padding:24px 0;">Nothing yet tonight</div>
    `;
    const canvas = document.getElementById('chart');
    if (canvas && window.drawLine) drawLine(canvas, [200, 208, 203, 210, 198], '#00d35a');
  } else if (currentTab === 'agents') {
    content.innerHTML = `
      <div style="font-size:22px; font-weight:700; margin:8px 0 16px;">Agents</div>
      <div class="card">${agentRow('🔍', '#64d2ff', 'Scanner', 'Listening for graduations', 'running')}</div>
      <div class="card">${agentRow('🛡️', '#ff9f0a', 'Auditor', '8 layers', 'running')}</div>
      <div class="card">${agentRow('⭐', '#ffd60a', 'Analyst', 'rules mode', 'running')}</div>
      <div class="card">${agentRow('⚡', '#00d35a', 'Executor', 'PAPER fills', 'running')}</div>
      <div class="card">${agentRow('🎯', '#ff6b9a', 'Risk', 'exits', 'running')}</div>
    `;
  } else if (currentTab === 'activity') {
    content.innerHTML = `
      <div style="font-size:22px; font-weight:700; margin:8px 0 16px;">Activity</div>
      <div style="color:var(--secondary); text-align:center; padding:40px 0;">Nothing yet tonight</div>
    `;
  } else if (currentTab === 'account') {
    content.innerHTML = `
      <div style="font-size:22px; font-weight:700; margin:8px 0 16px;">Account</div>
      <div class="card">
        <div style="margin-bottom:12px;">Mode <span class="pill" style="background:var(--orange); color:#000; float:right;">${mode}</span></div>
        <div>Stack <span style="float:right; font-variant-numeric:tabular-nums;">$${bal}</span></div>
        <div style="margin-top:16px; color:var(--blue);">Your FOMO profile</div>
        <div style="margin-top:8px; color:var(--blue);">Invite a friend</div>
      </div>
    `;
  }
  renderTabs();
}

function agentRow(icon, color, name, subtitle, right) {
  return `
    <div class="agent-row">
      <div class="agent-icon" style="background:${color}22; color:${color};">${icon}</div>
      <div style="flex:1;">
        <div style="font-weight:600;">${name}</div>
        <div style="color:var(--secondary); font-size:13px;">${subtitle}</div>
      </div>
      <div style="color:var(--secondary); font-size:13px;">${right}</div>
    </div>
  `;
}

function renderTabs() {
  const tabs = [
    { id: 'home', label: 'Home' },
    { id: 'agents', label: 'Agents' },
    { id: 'activity', label: 'Activity' },
    { id: 'account', label: 'Account' }
  ];
  document.getElementById('tabbar').innerHTML = tabs.map(t =>
    `<div class="tab ${currentTab === t.id ? 'active' : ''}" data-tab="${t.id}">${t.label}</div>`
  ).join('');
  document.querySelectorAll('.tab').forEach(el => {
    el.onclick = () => { currentTab = el.dataset.tab; render(); };
  });
}

setInterval(poll, 8000);
poll();
