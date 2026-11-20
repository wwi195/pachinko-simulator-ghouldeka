const P_ZUGAR        = 1 / 999.9;
const P_CHARGE       = 1 / 538.3;
const P_RUSH         = 1 / 7.7;
const P_FALSE_ENZOKU = P_ZUGAR * (0.3 / 0.7);
const SPIN_COST      = 250 / 30;

const game = {
  state: 'normal_idle',
  mode: 'normal',
  mochiDama: 0,
  toushi: 0,
  totalSpins: 0,
  currentSpins: 0,    // 図柄ぞろいでリセット
  lastHitSpins: 0,    // 前回大当たり時の totalSpins（間隔計算用）
  zugarCount: 0,
  chargeCount: 0,
  rushEntryCount: 0,
  totalRushHits: 0,
  allRushStats: { rushTotalSpins: 0, bonus6000: 0, uenose3000: 0, bonus3000: 0 },
  rushRemaining: 0,
  pending: {},
  rushStats: resetRushStats(),
  eigyoAlertShown: false,
  hitHistory: [],     // 大当たり履歴 [{games, kind, chain}]（新しい順。chain=null はRUSH結果待ち、0はRUSHなし）
  lastAnyHitTotal: 0, // 直前の大当たり（チャージ・図柄揃い）時点の総回転数
  log: [],
};

function resetRushStats() {
  return { actualBalls: 0, nominalBalls: 0, bonus6000: 0, uenose3000: 0, bonus3000: 0, chainCount: 0, uenoseChain: 0, rushTotalSpins: 0 };
}

function rand() { return Math.random(); }

// ---- スピン判定 ----

function spinNormal() {
  if (rand() < P_ZUGAR)        return 'zugar';
  if (rand() < P_FALSE_ENZOKU) return 'false_enzoku';
  if (rand() < P_CHARGE)       return 'charge';
  return 'miss';
}

function spinRush() {
  return rand() < P_RUSH ? 'hit' : 'miss';
}

// ---- 球数・投資 ----

function consumeSpinCost() {
  if (game.mochiDama >= SPIN_COST) {
    game.mochiDama -= SPIN_COST;
  } else {
    const shortfall = SPIN_COST - game.mochiDama;
    game.mochiDama = 0;
    const units = Math.ceil(shortfall / 250);
    game.toushi   += units * 1000;
    game.mochiDama = units * 250 - shortfall;
  }
  recordSlump();
}

function addBalls(n) {
  game.mochiDama += n;
}

function addLog(text, type = '') {
  game.log.unshift({ text, type });
  if (game.log.length > 50) game.log.pop();
  renderLog();
}

// ---- ハンドラ ----

function handleStart() {
  if (!game.eigyoAlertShown && game.totalSpins >= 4000) {
    game.eigyoAlertShown = true;
    setState('eigyo_alert');
    return;
  }
  game.totalSpins++;
  game.currentSpins++;
  consumeSpinCost();
  const result = spinNormal();
  const interval = game.totalSpins - game.lastHitSpins;

  if (result === 'zugar') {
    game.pending = { type: 'zugar' };
    addLog(`${interval}回転で先バレ発生！`);
    setState('enzoku');
  } else if (result === 'false_enzoku') {
    game.pending = { type: 'false' };
    addLog(`${interval}回転で先バレ発生！`);
    setState('enzoku');
  } else if (result === 'charge') {
    game.chargeCount++;
    recordHit('charge', 0);
    addBalls(280);
    addLog(`${interval}回転でチャージ ＋280球`, 'charge');
    setState('charge_result');
  } else {
    setState('lose_result');
  }
}

function autoSpin(count) {
  for (let i = 0; i < count; i++) {
    if (!game.eigyoAlertShown && game.totalSpins >= 4000) {
      game.eigyoAlertShown = true;
      setState('eigyo_alert');
      return;
    }
    game.totalSpins++;
    game.currentSpins++;
    consumeSpinCost();
    const result = spinNormal();
    const interval = game.totalSpins - game.lastHitSpins;

    if (result === 'zugar' || result === 'false_enzoku') {
      game.pending = { type: result === 'zugar' ? 'zugar' : 'false' };
      addLog(`${interval}回転で先バレ発生！`);
      setState('enzoku');
      return;
    } else if (result === 'charge') {
      game.chargeCount++;
      recordHit('charge', 0);
      addBalls(280);
      addLog(`${interval}回転でチャージ ＋280球`, 'charge');
    }
  }
  setState('normal_idle');
}

function handleEnzokuJudge() {
  if (game.pending.type === 'zugar') {
    addLog('図柄ぞろい！', 'win');
    setState('win_result');
  } else {
    addLog('はずれ');
    setState('lose_result');
  }
}

function handleZugarVibun() {
  const isPremium = rand() < 0.5;
  const balls = isPremium ? 7000 : 2800;
  addBalls(balls);
  game.zugarCount++;
  recordHit('zugar', isPremium ? null : 0);
  game.currentSpins  = 0;
  game.lastHitSpins  = game.totalSpins;
  game.pending = { premium: isPremium };
  if (isPremium) {
    addLog('7500 PREMIUMボーナス！ ＋7000球 → RUSH突入', 'rush');
  } else {
    addLog('3000ボーナス ＋2800球 → 通常へ');
  }
  setState('zugar_vibun');
}

function handleAfterZugar() {
  if (game.pending.premium) {
    game.rushEntryCount++;
    game.mode = 'rush';
    game.rushRemaining = 5;
    game.rushStats = resetRushStats();
    game.rushStats.chainCount = 1; // 初当たりを1連チャン目として数える（RUSH中1回当たると2連）
    game.rushStats.actualBalls  = 7000;
    game.rushStats.nominalBalls = 7500;
    setState('rush_idle');
  } else {
    game.mode = 'normal';
    setState('normal_idle');
  }
}

function handleRushStart() {
  game.rushStats.rushTotalSpins++;
  game.allRushStats.rushTotalSpins++;
  const result = spinRush();
  game.rushRemaining--;

  if (result === 'hit') {
    const big = rand() < 0.5;
    if (big) {
      addBalls(5600);
      game.totalRushHits++;
      game.allRushStats.bonus6000++;
      game.rushStats.bonus6000++;
      game.rushStats.chainCount++;
      game.rushStats.uenoseChain = 0;
      game.rushStats.actualBalls  += 5600;
      game.rushStats.nominalBalls += 6000;
      addLog(`6000ボーナス！ ＋5600球 (${game.rushStats.chainCount}連)`, 'rush');
      game.pending = { retry: false };
      setState('rush_uenose_judge');
    } else {
      addBalls(2800);
      game.totalRushHits++;
      game.allRushStats.bonus3000++;
      game.rushStats.bonus3000++;
      game.rushStats.chainCount++;
      game.rushStats.actualBalls  += 2800;
      game.rushStats.nominalBalls += 3000;
      addLog(`3000ボーナス ＋2800球 (${game.rushStats.chainCount}連)`, 'rush');
      setState('rush_hit_3000');
    }
  } else {
    addLog(`電サポ外れ（残り${game.rushRemaining}回）`);
    // 電サポ中の外れは「外れ」画面を出さない（電サポ終了のときだけ終了画面を出す）
    if (game.rushRemaining > 0) setState('rush_idle'); else setState('rush_miss');
  }
}

function handleUenoseJudge() {
  if (rand() < 0.5) {
    addBalls(2800);
    game.rushStats.uenose3000++;
    game.allRushStats.uenose3000++;
    game.rushStats.uenoseChain++;
    game.rushStats.actualBalls  += 2800;
    game.rushStats.nominalBalls += 3000;
    addLog(`上乗せ3000！ ＋2800球 (上乗せ${game.rushStats.uenoseChain}連)`, 'add');
    setState('rush_uenose_win');
  } else {
    addLog('上乗せなし → RUSH5回転再開', 'rush');
    game.rushRemaining = 5;
    setState('rush_uenose_lose');
  }
}

function handleAfterUenoseWin() {
  game.pending = { retry: true };
  setState('rush_uenose_judge');
}

function handleAfterUenoseLose() {
  setState('rush_idle');
}

function handleRushHit3000Vibun() {
  addLog('RUSH継続！', 'rush');
  game.rushRemaining = 5;
  setState('rush_idle');
}

function handleRushMissContinue() {
  if (game.rushRemaining > 0) {
    setState('rush_idle');
  } else {
    setLatestHitChain(game.rushStats.chainCount);
    setState('rush_result');
  }
}

function handleRushResultEnd() {
  addLog('RUSH終了 → 通常時へ');
  game.mode = 'normal';
  setState('normal_idle');
}

function backToNormal() {
  game.mode = 'normal';
  setState('normal_idle');
}

function handleEigyoHai() {
  setState(game.mode === 'rush' ? 'rush_idle' : 'normal_idle');
}

function handleEigyoIie() {
  setState('taiten_result');
}

function handleTaiten() {
  setState('taiten_result');
}

function resetGame() {
  game.state           = 'normal_idle';
  game.mode            = 'normal';
  game.mochiDama       = 0;
  game.toushi          = 0;
  game.totalSpins      = 0;
  game.currentSpins    = 0;
  game.lastHitSpins    = 0;
  game.zugarCount      = 0;
  game.chargeCount     = 0;
  game.rushEntryCount  = 0;
  game.totalRushHits   = 0;
  game.allRushStats    = { rushTotalSpins: 0, bonus6000: 0, uenose3000: 0, bonus3000: 0 };
  game.rushRemaining   = 0;
  game.pending         = {};
  game.rushStats       = resetRushStats();
  game.eigyoAlertShown = false;
  game.hitHistory      = [];
  game.lastAnyHitTotal = 0;
  game.slump = [{ x: 0, y: 0 }];
  game.log             = [];
  render();
}

// ---- 状態セット & レンダリング ----

function setState(state) {
  game.state = state;
  render();
}

// ---- 大当たり履歴グラフ ----
function recordHit(kind, chain) {
  const games = game.totalSpins - game.lastAnyHitTotal;
  game.lastAnyHitTotal = game.totalSpins;
  game.hitHistory.unshift({ games, kind, chain });
}
function setLatestHitChain(chain) {
  const last = game.hitHistory[0];
  if (last && last.chain === null) last.chain = chain;
}

const HIST_BLOCK = 100;
const HIST_MAX_BLOCKS = 7;
function renderHitGraph() {
  const el = document.getElementById('hist-cols');
  if (!el) return;
  const col = (cls, games, label, idx) => {
    const blocks = Math.min(HIST_MAX_BLOCKS, Math.max(1, Math.ceil(games / HIST_BLOCK)));
    const more = games >= HIST_BLOCK * HIST_MAX_BLOCKS ? '<div class="hist-more">▲</div>' : '';
    return `<div class="hist-col ${cls}">
      <div class="hist-g">${games}</div>${more}
      ${'<div class="hist-block"></div>'.repeat(blocks)}
      <div class="hist-type">${label}</div>
      <div class="hist-idx">${idx}</div>
    </div>`;
  };
  let html = col('now', game.totalSpins - game.lastAnyHitTotal, '現在', '');
  game.hitHistory.forEach((h, i) => {
    let cls, label;
    if (h.chain === null) { cls = 'pending'; label = '…'; }
    else if (h.chain >= 1) { cls = h.chain >= 10 ? 'big-chain' : 'rush'; label = `${h.chain}連`; }
    else if (h.kind === 'charge') { cls = 'charge'; label = 'チャージ'; }
    else { cls = 'zugar'; label = '図柄'; }
    html += col(cls, h.games, label, i + 1);
  });
  if (game.hitHistory.length === 0) html += '<div class="hist-empty">まだ大当たりがありません</div>';
  el.innerHTML = html;
}

// ---- 差玉推移グラフ ----
// 差玉 = 持ち玉 − 投資玉（1000円=250玉）。横軸は通常時の総回転数
function currentDiffBalls() {
  return Math.round(game.mochiDama - game.toushi / 4);
}
function recordSlump() {
  if (!game.slump) game.slump = [{ x: 0, y: 0 }];
  const y = currentDiffBalls();
  const pts = game.slump;
  const last = pts[pts.length - 1];
  if (last.x === game.totalSpins && last.y === y) return;
  pts.push({ x: game.totalSpins, y });
  if (pts.length > 40000) game.slump = pts.filter((_, i) => i % 2 === 0 || i === pts.length - 1);
}
function slumpNiceStep(range) {
  const raw = range / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}
function renderSlumpGraph() {
  const el = document.getElementById('slump-svg');
  if (!el) return;
  recordSlump();
  const pts = game.slump;
  const W = 360, H = 170, L = 46, R = 8, T = 10, B = 22;
  const maxX = Math.max(100, pts[pts.length - 1].x);
  let minY = 0, maxY = 0;
  pts.forEach((p) => { if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; });
  if (maxY - minY < 1000) { maxY += 500; minY -= 500; }
  const step = slumpNiceStep(maxY - minY);
  minY = Math.floor(minY / step) * step;
  maxY = Math.ceil(maxY / step) * step;
  const sx = (x) => L + (x / maxX) * (W - L - R);
  const sy = (y) => T + (1 - (y - minY) / (maxY - minY)) * (H - T - B);
  let grid = '';
  for (let v = minY; v <= maxY + 1e-9; v += step) {
    const y = sy(v).toFixed(1);
    grid += `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" class="${v === 0 ? 'sl-zero' : 'sl-grid'}"/>`;
    grid += `<text x="${L - 4}" y="${(+y + 3).toFixed(1)}" class="sl-ylab">${v.toLocaleString()}</text>`;
  }
  const xStep = slumpNiceStep(maxX);
  for (let v = 0; v <= maxX + 1e-9; v += xStep) {
    const anchor = sx(v) > W - R - 16 ? ' style="text-anchor:end"' : '';
    grid += `<text x="${sx(v).toFixed(1)}" y="${H - 6}" class="sl-xlab"${anchor}>${v.toLocaleString()}</text>`;
  }
  const maxPts = (W - L - R) * 2;
  const stride = Math.max(1, Math.floor(pts.length / maxPts));
  const line = pts.filter((_, i) => i % stride === 0 || i === pts.length - 1)
    .map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
  const cur = pts[pts.length - 1];
  const cls = cur.y >= 0 ? 'plus' : 'minus';
  // 0より上はプラス色、下はマイナス色で塗り分ける
  const zeroOff = Math.min(1, Math.max(0, (sy(0) - T) / (H - T - B))).toFixed(4);
  el.innerHTML = `<defs><linearGradient id="sl-grad" gradientUnits="userSpaceOnUse" x1="0" y1="${T}" x2="0" y2="${H - B}">
      <stop offset="${zeroOff}" stop-color="#44cc88"/><stop offset="${zeroOff}" stop-color="#ff6b6b"/>
    </linearGradient></defs>
    ${grid}
    <polyline points="${line}" class="sl-line" stroke="url(#sl-grad)"/>
    <circle cx="${sx(cur.x).toFixed(1)}" cy="${sy(cur.y).toFixed(1)}" r="3" class="sl-dot ${cls}"/>`;
  document.getElementById('slump-now').innerHTML =
    `現在 <b class="${cls}">${cur.y >= 0 ? '+' : ''}${cur.y.toLocaleString()}玉</b>（${game.totalSpins.toLocaleString()}回転）`;
}

function render() {
  renderHeader();
  renderModeBadge();
  renderMainScreen();
  renderRushStats();
  renderHitGraph();
  renderSlumpGraph();
}

function renderHeader() {
  const mochiInt = Math.floor(game.mochiDama);
  document.getElementById('mochi-dama').textContent   = mochiInt.toLocaleString();
  document.getElementById('toushi-value').textContent = game.toushi.toLocaleString();

  const shuushi   = mochiInt * 4 - game.toushi;
  const shuushiEl = document.getElementById('shuushi-value');
  shuushiEl.textContent = (shuushi >= 0 ? '+' : '') + shuushi.toLocaleString();
  shuushiEl.className   = 'money-value ' + (shuushi >= 0 ? 'green' : 'red');
  document.getElementById('current-spins').textContent = game.currentSpins.toLocaleString();
  document.getElementById('total-spins-disp').textContent = game.totalSpins.toLocaleString();
  const el = document.getElementById('rush-count');
  el.textContent = game.mode === 'rush' ? `${game.rushRemaining}回` : '－';

  // 大当たり統計
  document.getElementById('zugar-count').textContent  = game.zugarCount + '回';
  document.getElementById('charge-count').textContent = game.chargeCount + '回';

  const zugarProb = game.zugarCount > 0 && game.totalSpins > 0
    ? '1/' + Math.round(game.totalSpins / game.zugarCount).toLocaleString()
    : '1/999';
  const chargeProb = game.chargeCount > 0 && game.totalSpins > 0
    ? '1/' + Math.round(game.totalSpins / game.chargeCount).toLocaleString()
    : '1/538';
  document.getElementById('zugar-prob').textContent  = zugarProb;
  document.getElementById('charge-prob').textContent = chargeProb;

  const rushRate = game.zugarCount > 0
    ? Math.round(game.rushEntryCount / game.zugarCount * 100)
    : 0;
  document.getElementById('rush-entry-info').textContent =
    `(RUSH突入${game.rushEntryCount}回・${rushRate}%)`;

  // 大当たり総回数（図柄＋チャージ＋RUSH中）
  const normalHits = game.zugarCount + game.chargeCount;
  const grandTotal = normalHits + game.totalRushHits;
  document.getElementById('total-hit-count').textContent = grandTotal + '回';

  // 通常時初当たり
  document.getElementById('normal-first-hit').textContent  = normalHits + '回';
  document.getElementById('normal-first-prob').textContent = normalHits > 0 && game.totalSpins > 0
    ? '1/' + Math.round(game.totalSpins / normalHits).toLocaleString()
    : '1/―';
}

function renderModeBadge() {
  const el = document.getElementById('mode-badge');
  if (game.mode === 'rush') {
    el.textContent = 'RUSH中';
    el.className = 'rush';
  } else {
    el.textContent = '通常時';
    el.className = '';
  }
}

function renderMainScreen() {
  document.getElementById('main-screen').innerHTML = buildScreen(game.state);
}

function buildScreen(state) {
  switch (state) {

    case 'normal_idle':
      return `<div class="screen">
        <button class="btn-start" onclick="handleStart()">START</button>
        <p class="prob-hint">図柄ぞろい 1/999.9　チャージ 1/538.3</p>
        <div class="auto-spin-btns">
          <div class="auto-spin-wrap">
            <button class="btn-auto" onclick="autoSpin(100)">100回転</button>
            <p class="spin-cost-hint">約3,300円消費</p>
          </div>
          <div class="auto-spin-wrap">
            <button class="btn-auto" onclick="autoSpin(300)">300回転</button>
            <p class="spin-cost-hint">約10,000円消費</p>
          </div>
        </div>
        <button class="btn-taiten" onclick="handleTaiten()">退店する</button>
      </div>`;

    case 'enzoku':
      return `<div class="screen">
        <p class="enzoku-label">先バレ発生！</p>
        <img src="画像/グール先バレ.webp" class="enzoku-img" alt="先バレ演出">
        <p class="shinraiudo">信頼度 70%</p>
        <button class="btn-action" onclick="handleEnzokuJudge()">▶ 判定に進む</button>
      </div>`;

    case 'win_result':
      return `<div class="screen">
        <p class="result-main win">図柄ぞろい！</p>
        <p style="font-size:56px; margin:4px 0;">🎰</p>
        <button class="btn-action" onclick="handleZugarVibun()">▶ 振り分けへ</button>
      </div>`;

    case 'lose_result':
      return `<div class="screen">
        <p class="result-main lose">はずれ</p>
        <button class="btn-sub" onclick="backToNormal()" style="margin-top:8px;">続ける</button>
      </div>`;

    case 'charge_result':
      return `<div class="screen">
        <p class="result-main charge">チャージ！</p>
        <p class="result-balls">＋280球</p>
        <button class="btn-sub" onclick="backToNormal()">続ける</button>
      </div>`;

    case 'zugar_vibun': {
      const isPremium = game.pending.premium;
      return `<div class="screen">
        <div class="vibun-box ${isPremium ? 'rush-box' : 'normal-box'}">
          <p class="bonus-main ${isPremium ? 'premium' : 'standard'}">
            ${isPremium ? '7500 PREMIUMボーナス' : '3000ボーナス'}
          </p>
          <p class="bonus-sub">＋${isPremium ? '7,000' : '2,800'}球獲得</p>
          ${isPremium ? '<p class="rush-announce">🔥 RUSH突入！</p>' : ''}
        </div>
        <button class="btn-action" onclick="handleAfterZugar()">
          ▶ ${isPremium ? 'RUSHへ' : '通常へ'}
        </button>
      </div>`;
    }

    case 'rush_idle':
      return `<div class="screen">
        <p class="chain-label">${game.rushStats.chainCount}連チャン中</p>
        <p class="rush-title">RUSH</p>
        <p class="rush-sub">電サポ残り <span>${game.rushRemaining}</span> 回</p>
        <button class="btn-start rush-btn" onclick="handleRushStart()">START</button>
        <p class="prob-hint">大当たり確率 1/7.7</p>
        <button class="btn-taiten" onclick="handleTaiten()">退店する</button>
      </div>`;

    case 'rush_uenose_judge': {
      const isRetry = game.pending.retry;
      const uc = game.rushStats.uenoseChain;
      return `<div class="screen">
        ${isRetry
          ? `<p class="chain-label uenose-chain">上乗せ${uc}連中</p>
             <p class="add-rush-title">再上乗せチャンス！</p>
             <p class="result-sub" style="margin-bottom:6px;">継続率 50%</p>`
          : `<p class="chain-label">${game.rushStats.chainCount}連チャン中</p>
             <div class="vibun-box rush-box" style="margin-bottom:12px;">
               <p class="bonus-main premium">6000ボーナス</p>
               <p class="bonus-sub">＋5600球獲得</p>
             </div>`
        }
        <button class="btn-action uenose-btn" onclick="handleUenoseJudge()">▶ 上乗せジャッジ</button>
      </div>`;
    }

    case 'rush_uenose_win':
      return `<div class="screen">
        <p class="chain-label uenose-chain">上乗せ${game.rushStats.uenoseChain}連中</p>
        <p class="add-rush-title">再上乗せ！</p>
        <p class="bonus-sub" style="margin-bottom:10px;">上乗せ3000 ＋2800球獲得</p>
        <img src="画像/RUSH中　追加ボーナス演出.png" class="enzoku-img" alt="追加ボーナス演出"
          onerror="this.style.display='none'">
        <button class="btn-action" style="margin-top:14px;" onclick="handleAfterUenoseWin()">▶ 次へ</button>
      </div>`;

    case 'rush_uenose_lose':
      return `<div class="screen">
        <p class="result-main lose" style="font-size:32px;">はずれ</p>
        <p class="result-sub" style="margin-top:6px;">上乗せなし → RUSH5回転再開</p>
        <button class="btn-sub" onclick="handleAfterUenoseLose()" style="margin-top:16px;">続ける</button>
      </div>`;

    case 'rush_hit_3000':
      return `<div class="screen">
        <div class="vibun-box rush-box">
          <p class="bonus-main standard">3000ボーナス</p>
          <p class="bonus-sub">＋2800球獲得</p>
        </div>
        <button class="btn-action" onclick="handleRushHit3000Vibun()" style="margin-top:16px;">
          ▶ RUSH継続へ
        </button>
      </div>`;

    case 'rush_miss': {
      const remaining = game.rushRemaining;
      if (remaining > 0) {
        return `<div class="screen">
          <p class="result-main lose">外れ</p>
          <p style="color:#ff9900; font-size:18px; margin-top:4px;">電サポ残り ${remaining}回</p>
          <button class="btn-sub" onclick="handleRushMissContinue()" style="margin-top:12px;">続ける</button>
        </div>`;
      } else {
        return `<div class="screen">
          <p class="result-main lose" style="font-size:26px;">電サポ終了…</p>
          <button class="btn-sub" onclick="handleRushMissContinue()" style="margin-top:12px;">結果へ</button>
        </div>`;
      }
    }

    case 'rush_result': {
      const s = game.rushStats;
      const lines = [];
      lines.push(`<div class="result-row">
        <span class="rr-label">7500 PREMIUMボーナス</span>
        <span class="rr-val" style="color:#f0c040;">×1回</span>
      </div>`);
      if (s.bonus6000 > 0) {
        lines.push(`<div class="result-row">
          <span class="rr-label">6000ボーナス</span>
          <span class="rr-val">×${s.bonus6000}回</span>
        </div>`);
        if (s.uenose3000 > 0) {
          lines.push(`<div class="result-row indent">
            <span class="rr-label">└ 上乗せ3000</span>
            <span class="rr-val">×${s.uenose3000}回</span>
          </div>`);
        }
      }
      if (s.bonus3000 > 0) {
        lines.push(`<div class="result-row">
          <span class="rr-label">3000ボーナス</span>
          <span class="rr-val">×${s.bonus3000}回</span>
        </div>`);
      }
      if (lines.length === 0) lines.push(`<p style="color:#555; font-size:13px;">大当たりなし</p>`);
      return `<div class="screen">
        <p class="rush-result-title">RUSH リザルト</p>
        <div class="rush-result-box">
          <div class="result-row highlight">
            <span class="rr-label">連チャン数</span>
            <span class="rr-val gold">${s.chainCount}連チャン</span>
          </div>
          <div class="result-row">
            <span class="rr-label">獲得出玉</span>
            <span class="rr-val gold">${s.actualBalls.toLocaleString()}球</span>
          </div>
          <div class="result-row">
            <span class="rr-label">表示出玉</span>
            <span class="rr-val">${s.nominalBalls.toLocaleString()}個</span>
          </div>
          <hr class="result-hr">
          <p class="rr-section">ボーナス内訳</p>
          ${lines.join('')}
        </div>
        <button class="btn-action" onclick="handleRushResultEnd()" style="margin-top:16px;">▶ 通常へ戻る</button>
      </div>`;
    }

    case 'eigyo_alert':
      return `<div class="screen">
        <p style="font-size:22px; font-weight:bold; color:#f0c040; text-align:center; line-height:1.6;">
          営業時間終了になりました
        </p>
        <p style="font-size:16px; color:#ccc; text-align:center;">このまま居座り続けますか？</p>
        <div style="display:flex; gap:16px; margin-top:8px;">
          <button class="btn-action" style="flex:1;" onclick="handleEigyoHai()">はい</button>
          <button class="btn-action" style="flex:1; background:linear-gradient(135deg,#555,#333); border-color:#888;"
            onclick="handleEigyoIie()">いいえ</button>
        </div>
      </div>`;

    case 'taiten_result': {
      const mochi    = Math.floor(game.mochiDama);
      const mochiYen = mochi * 4;
      const shuushi  = mochiYen - game.toushi;
      const shuushiColor = shuushi >= 0 ? '#44cc88' : '#cc6666';
      const shuushiSign  = shuushi >= 0 ? '＋' : '';
      return `<div class="screen">
        <p style="font-size:24px; font-weight:bold; color:#aaa;">退店します</p>
        <div class="rush-result-box" style="max-width:320px;">
          <p class="rr-section" style="margin-bottom:8px;">収支発表</p>
          <div class="result-row">
            <span class="rr-label">総回転数</span>
            <span class="rr-val">${game.totalSpins.toLocaleString()}回</span>
          </div>
          <div class="result-row">
            <span class="rr-label">投資金額</span>
            <span class="rr-val" style="color:#cc6666;">${game.toushi.toLocaleString()}円</span>
          </div>
          <div class="result-row">
            <span class="rr-label">持ち球換算</span>
            <span class="rr-val">${mochiYen.toLocaleString()}円</span>
          </div>
          <hr class="result-hr">
          <div class="result-row highlight">
            <span class="rr-label" style="font-weight:bold;">収支</span>
            <span class="rr-val" style="color:${shuushiColor}; font-size:22px;">
              ${shuushiSign}${shuushi.toLocaleString()}円
            </span>
          </div>
          <hr class="result-hr">
          <div class="result-row">
            <span class="rr-label">図柄ぞろい</span>
            <span class="rr-val">${game.zugarCount}回</span>
          </div>
          <div class="result-row">
            <span class="rr-label">チャージ</span>
            <span class="rr-val">${game.chargeCount}回</span>
          </div>
          <div class="result-row">
            <span class="rr-label">RUSH大当たり</span>
            <span class="rr-val">${game.totalRushHits}回</span>
          </div>
        </div>
        <button class="btn-action" onclick="resetGame()" style="margin-top:8px;">▶ 最初の画面に戻る</button>
      </div>`;
    }

    default:
      return `<div class="screen"><p>...</p></div>`;
  }
}

function renderRushStats() {
  const a     = game.allRushStats;
  const hits  = game.totalRushHits;
  const spins = a.rushTotalSpins;
  const prob  = hits > 0 && spins > 0
    ? '1/' + (spins / hits).toFixed(1)
    : '1/―';
  document.getElementById('rs-chain').textContent  = hits + '回';
  document.getElementById('rs-prob').textContent   = prob;
  document.getElementById('rs-spins').textContent  = spins + '回';
  document.getElementById('rs-6000').textContent   = a.bonus6000 + '回';
  document.getElementById('rs-uenose').textContent = a.uenose3000 + '回';
  document.getElementById('rs-3000').textContent   = a.bonus3000 + '回';
}

function renderLog() {
  const el = document.getElementById('log-list');
  el.innerHTML = game.log.map(item =>
    `<div class="log-item ${item.type}">${item.text}</div>`
  ).join('');
}

render();
