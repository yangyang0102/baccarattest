// Build v28
const BUILD_VERSION = "v1.47";

function onEvent(id, event, handler){
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener(event, handler);
}
function on(id, handler){ onEvent(id, "click", handler); }

// 豪樂百家輔助程式 v9
// 只保留你 Excel 那套：HV/AG/TP -> 「下局」主注建議（莊/閒/看一局）
// 修正：主注統計「贏/輸/和/略過」會用「上一局的建議」去對照「本局開牌結果」
//
// 指令：undo / redo / reset / clear
// UI：可用文字輸入，也可用按鈕輸入（閒/莊切換 + 1~13）

const HV_MAP = {1:9, 2:8, 3:7, 4:6, 5:5, 6:1, 7:3, 8:2, 9:2};
const AG_MAP = {0:-4, 1:-5, 2:-5, 3:-2, 4:-1, 5:-1, 6:3, 7:4, 8:5, 9:6};

function rankToVal(r){
  if (r === 1) return 1;
  if (r >= 2 && r <= 9) return r;
  return 0; // 10/J/Q/K
}
function handTotal(ranks){
  let s = 0;
  for (const r of ranks) s += rankToVal(r);
  return s % 10;
}
function max1to9(ranks){
  const vals = [];
  for (const r of ranks){
    if (r === 1) vals.push(1);
    else if (r >= 2 && r <= 9) vals.push(r);
  }
  if (!vals.length) return null;
  return Math.max(...vals);
}
function winnerLabel(pTotal, bTotal){
  if (pTotal > bTotal) return "閒家";
  if (bTotal > pTotal) return "莊家";
  return "和";
}

function baccaratPoint(v){
  // v: 1-13 (A..K), baccarat point: A=1, 2-9=face, 10/J/Q/K=0
  if (!v) return 0;
  if (v >= 10) return 0;
  return v;
}
function baccaratTotal(cards){
  let s = 0;
  for (const v of (cards||[])) s += baccaratPoint(v);
  return s % 10;
}
function isNatural(p2, b2){
  return p2 === 8 || p2 === 9 || b2 === 8 || b2 === 9;
}
function bankerShouldDraw(b2, p3Point){
  // assumes player drew third card; use standard table
  if (b2 <= 2) return true;
  if (b2 === 3) return p3Point !== 8;
  if (b2 === 4) return p3Point >= 2 && p3Point <= 7;
  if (b2 === 5) return p3Point >= 4 && p3Point <= 7;
  if (b2 === 6) return p3Point === 6 || p3Point === 7;
  return false; // 7 stands
}
function expectedSide(){
  // Auto dealing order with forced draw rules
  const p = state.keypad.p || [];
  const b = state.keypad.b || [];
  const seq = state.keypad.seq || [];
  const total = p.length + b.length;

  if (total < 2) return "P";      // Player first two
  if (total < 4) return "B";      // Banker next two

  const p2 = baccaratTotal(p.slice(0,2));
  const b2 = baccaratTotal(b.slice(0,2));

  if (isNatural(p2,b2)) return null; // no draws

  // Need to ensure we don't allow impossible states
  if (p.length < 2 || b.length < 2) return null;

  // Player draw decision
  if (p.length === 2 && b.length === 2){
    if (p2 <= 5) return "P"; // player draws third
    // player stands, banker draws on 0-5
    if (b2 <= 5) return "B";
    return null;
  }

  // After player drew third
  if (p.length === 3 && b.length === 2){
    const p3 = baccaratPoint(p[2]);
    if (bankerShouldDraw(b2, p3)) return "B";
    return null;
  }

  // If banker already drew third, stop
  return null;
}

function updateInputStatus(){
  const el = document.getElementById("inputStatus");
  if (!el) return;

  const p = state.keypad?.p || [];
  const b = state.keypad?.b || [];
  const total = p.length + b.length;

  let msg = "";
  if (total < 2) msg = "目前輸入：閒（第1張）";
  else if (total < 4){
    msg = total === 2 ? "目前輸入：莊（第1張）" : "目前輸入：莊（第2張）";
  }else{
    const nextSide = expectedSide();
    if (!nextSide){
      const p2 = baccaratTotal(p.slice(0,2));
      const b2 = baccaratTotal(b.slice(0,2));
      if (isNatural(p2,b2)) msg = "8/9 例牌：本局不補牌";
      else msg = "本局輸入完成";
    }else if (nextSide === "P") msg = "目前輸入：閒（補牌）";
    else msg = "目前輸入：莊（補牌）";
  }
  el.textContent = msg;
}


function parseHand(line){
  const s = line.trim().toLowerCase();
  if (!s) return null;
  if (["undo","redo","reset","stats","clear"].includes(s)) return {cmd:s};
  const parts = line.trim().split(/\s+/);
  if (parts.length !== 2) throw new Error("格式錯誤：請輸入「閒牌(用.) 莊牌(用.)」，中間用空白隔開，例如：12.12.6 10.12.9");
  const p = parts[0].split('.').filter(Boolean).map(x=>parseInt(x,10));
  const b = parts[1].split('.').filter(Boolean).map(x=>parseInt(x,10));
  for (const r of [...p,...b]){
    if (!(r>=1 && r<=13) || Number.isNaN(r)) throw new Error("牌面需為 1~13 的數字");
  }
  return {p,b};
}

function deepClone(obj){ return JSON.parse(JSON.stringify(obj)); }

const STORAGE_KEY_BASE = "baccarat_main_only_v3";
const ACTIVE_TAB_KEY = "baccarat_active_tab_v1";
const LEGACY_STORAGE_KEY = "baccarat_main_only_v3";
const TABS = ["A","B","C","D","E","F"];

function storageKey(tab){ return `${STORAGE_KEY_BASE}__${tab}`; }

let activeTab = (localStorage.getItem(ACTIVE_TAB_KEY) || "A").toUpperCase();
if (!TABS.includes(activeTab)) activeTab = "A";

function newState(){
  return {
    prevP: null,
    prevB: null,
    pendingPick: null, // 上一局產生的「下局建議」，等待本局結算

    stats: {
      handNo:0,
      bankerWins:0, playerWins:0, ties:0,
      pickWins:0, pickLosses:0, pickTies:0, pickSkipped:0,
      courseWins:0, courseProgress:0, courseDone:false
    },

    log: [],
    undo: [],
    redo: [],

    keypad: { side: "P", p: [], b: [], seq: [] } // side: "P" or "B" (auto v17)
  };
}

migrateLegacyToAIfNeeded();
let state = loadState(activeTab) ?? newState();

function ensureStateFixups(){
// v1.39: course progress defaults + rebuild if missing
function rebuildCourseProgressFromLog(){
  let cw = 0;
  let prog = 0;
  // log is newest-first; iterate oldest -> newest
  for (const r of [...state.log].reverse()){
    const res = r.prevPickResult;
    if (res === "贏"){
      if (cw < 6) cw += 1;
      prog = 0;
    }else if (res === "輸"){
      prog += 1;
      if (prog >= 7) prog = 0;
    }
    if (cw >= 6) break;
  }
  state.stats.courseWins = cw;
  state.stats.courseProgress = prog;
  state.stats.courseDone = (cw >= 6);
}

if (state.stats.courseWins == null) state.stats.courseWins = 0;
if (state.stats.courseProgress == null) state.stats.courseProgress = 0;
if (state.stats.courseDone == null) state.stats.courseDone = false;
// If these fields were not persisted before, rebuild from existing log for consistency
if (!("courseWins" in state.stats) || !("courseProgress" in state.stats) || !("courseDone" in state.stats)){
  rebuildCourseProgressFromLog();
}

// v17: ensure keypad seq exists
state.keypad = state.keypad || {side:"P",p:[],b:[],seq:[]};
state.keypad.seq = state.keypad.seq || [];

}

ensureStateFixups();

function saveState(){
  localStorage.setItem(storageKey(activeTab), JSON.stringify(state));
}
function loadState(tab){
  try{
    const raw = localStorage.getItem(storageKey(tab));
    if (!raw) return null;
    return JSON.parse(raw);
  }catch{ return null; }
}

function migrateLegacyToAIfNeeded(){
  try{
    const hasA = localStorage.getItem(storageKey("A"));
    if (hasA) return;
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!legacy) return;
    localStorage.setItem(storageKey("A"), legacy);
    // optional: keep legacy as backup; do not remove
  }catch{}
}


function snapshot(){
  return {
    prevP: state.prevP,
    prevB: state.prevB,
    pendingPick: state.pendingPick,
    stats: deepClone(state.stats),
    log: deepClone(state.log),
    keypad: deepClone(state.keypad)
  };
}
function restore(snap){
  state.prevP = snap.prevP;
  state.prevB = snap.prevB;
  state.pendingPick = snap.pendingPick;
  state.stats = deepClone(snap.stats);
  state.log = deepClone(snap.log);
  state.keypad = deepClone(snap.keypad ?? {side:"P",p:[],b:[]});
}

function applyHandResult(win){
  const st = state.stats;
  st.handNo += 1;
  if (win === "莊家") st.bankerWins += 1;
  else if (win === "閒家") st.playerWins += 1;
  else st.ties += 1;
}


function updateCourseAfterPickResult(res){
  const st = state.stats;
  if (st.courseDone) return;

  if (res === "贏"){
    st.courseWins = (st.courseWins ?? 0) + 1;
    if (st.courseWins >= 6){
      st.courseWins = 6;
      st.courseDone = true;
    }
    st.courseProgress = 0;
  }else if (res === "輸"){
    st.courseProgress = (st.courseProgress ?? 0) + 1;
    if (st.courseProgress >= 7) st.courseProgress = 0;
  }
}
function settlePendingPick(win){
  const st = state.stats;
  const pick = state.pendingPick;
  if (!pick || pick === "看一局"){
    st.pickSkipped += 1;
    return {evaluated: pick ?? "（無）", result: "略過"};
  }
  if (win === "和"){
    st.pickTies += 1;
    return {evaluated: pick, result: "和"};
  }
  if (pick === win){
    st.pickWins += 1;
    updateCourseAfterPickResult("贏");
    return {evaluated: pick, result: "贏"};
  }else{
    st.pickLosses += 1;
    updateCourseAfterPickResult("輸");
    return {evaluated: pick, result: "輸"};
  }
}

function excelNextPick(pRanks, bRanks){
  const pTotal = handTotal(pRanks);
  const bTotal = handTotal(bRanks);

  const pMax = max1to9(pRanks);
  const bMax = max1to9(bRanks);

  const pHv = (pMax==null)? null : (HV_MAP[pMax] ?? null);
  const bHv = (bMax==null)? null : (HV_MAP[bMax] ?? null);

  const pAg = (state.prevP==null)? null : (AG_MAP[Math.abs(pTotal - state.prevP)] ?? null);
  const bAg = (state.prevB==null)? null : (AG_MAP[Math.abs(bTotal - state.prevB)] ?? null);

  const tpP = (pHv==null || pAg==null || pAg===0)? null : (pHv / pAg);
  const tpB = (bHv==null || bAg==null || bAg===0)? null : (bHv / bAg);

  let pick = null;
  if (tpP!=null && tpB!=null){
    if (tpP > tpB) pick = "莊家";
    else if (tpB > tpP) pick = "閒家";
    else pick = "看一局";
  }

  state.prevP = pTotal;
  state.prevB = bTotal;

  return {pTotal, bTotal, tpP, tpB, nextPick: pick};
}

function fmt(x){
  if (x==null) return "（無）";
  return (Math.round(x*1e6)/1e6).toString();
}

function addLogLine(obj){
  state.log.unshift(obj);
  if (state.log.length > 200) state.log.length = 200;
}

function setText(id, text){
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}


function toFaceLabel(v){
  const s = String(v);
  if (s === "1") return "A";
  if (s === "11") return "J";
  if (s === "12") return "Q";
  if (s === "13") return "K";
  return s;
}


function baccaratPoints(cards){
  const list = Array.isArray(cards) ? cards : [];
  let sum = 0;
  for (const c of list){
    const n = Number(c);
    if (!Number.isFinite(n)) continue;
    if (n === 1) sum += 1;
    else if (n >= 2 && n <= 9) sum += n;
    else sum += 0; // 10/J/Q/K
  }
  return sum % 10;
}

function setHandChips(id, cards, side){
  const el = document.getElementById(id);
  if (!el) return;

  const list = Array.isArray(cards) ? cards : [];
  if (!list.length){
    el.innerHTML = '<div class="hand-wrap '+(side==="P"?'hand-p':'hand-b')+'"><div class="hand-chips"><span class="card-chip">（空）</span></div></div>';
    return;
  }

  const chips = list.map((c, idx)=>{
    const isLast = idx === list.length - 1;
    const label = escapeHtml(toFaceLabel(c));
    return '<span class="card-chip'+(isLast?' is-last':'')+'">'+label+'</span>';
  }).join("");

  // simple meta: show count (keeps it minimal)
  const meta = '<div class="hand-meta">總點數：'+baccaratPoints(list)+'</div>';

  el.innerHTML = '<div class="hand-wrap '+(side==="P"?'hand-p':'hand-b')+'"><div class="hand-chips">'+chips+'</div>'+meta+'</div>';
}


// ---- commands ----
function cmdUndo(){
  if (!state.undo.length) return {ok:false, msg:"沒有可撤銷的紀錄"};
  state.redo.push(snapshot());
  const snap = state.undo.pop();
  restore(snap);
  return {ok:true, msg:"已撤銷上一手（undo）"};
}
function cmdRedo(){
  if (!state.redo.length) return {ok:false, msg:"沒有可復原的紀錄"};
  state.undo.push(snapshot());
  const snap = state.redo.pop();
  restore(snap);
  return {ok:true, msg:"已復原（redo）"};
}
function cmdReset(){
  if (!confirm("確定重置此局牌靴嗎?\n\n是 / 否")) return;

  state = newState();
  saveState();
  render();
  return {ok:true, msg:"已重置（新靴/新一輪）"};
}
function cmdClearLog(){
  if (!confirm("清除紀錄只清除下方紀錄欄\n\n是 / 否")) return;

  state.log = [];
  saveState();
  render();
  return {ok:true, msg:"已清除紀錄（log）"};
}


function cmdUndoHand(){
  if (!state.log.length) return {ok:false, msg:"沒有可撤銷的本局"};
  const lastN = state.log[0].n;
  if (!confirm(`確定撤銷第${lastN}局嗎?\n\n是 / 否`)) return {ok:false, msg:"已取消"};
  const targetLen = state.log.length - 1;
  if (!state.undo.length) return {ok:false, msg:"沒有可撤銷的紀錄"};
  // 將目前狀態放入 redo（方便需要時回復）
  state.redo.push(snapshot());
  let safety = 500;
  while (state.undo.length && safety--){
    const snap = state.undo.pop();
    restore(snap);
    if (state.log.length === targetLen){
      saveState();
      render();
      return {ok:true, msg:`已撤銷第${lastN}局`};
    }
  }
  // 若找不到對應狀態，回復到原本狀態
  const back = state.redo.pop();
  if (back) restore(back);
  saveState();
  render();
  return {ok:false, msg:"撤銷失敗（找不到上一局狀態）"};
}

// ---- submit ----
function submit(line){
  const parsed = parseHand(line);
  if (!parsed) return;
  if (parsed.cmd){
    let r;
    if (parsed.cmd==="undo") r = cmdUndo();
    else if (parsed.cmd==="redo") r = cmdRedo();
    else if (parsed.cmd==="reset") r = cmdReset();
    else if (parsed.cmd==="clear") r = cmdClearLog();
    else r = {ok:true, msg:""};
    if (parsed.cmd!=="reset"){
      if (r.msg) setText("lastOut", r.msg);
      saveState(); render();
    }
    return;
  }

  state.redo = [];
  state.undo.push(snapshot());

  const {p,b} = parsed;

  // 本局結果
  const pTotal = handTotal(p);
  const bTotal = handTotal(b);
  const win = winnerLabel(pTotal, bTotal);

  // 結算上一局建議（對照本局）
  const settled = settlePendingPick(win);

  // 記入本局統計
  applyHandResult(win);

  // 產生下局建議
  const res = excelNextPick(p,b);
  state.pendingPick = res.nextPick;

  addLogLine({
    n: state.stats.handNo,
    input: line.trim(),
    pTotal: res.pTotal,
    bTotal: res.bTotal,
    win,
    prevPick: settled.evaluated,
    prevPickResult: settled.result,
    nextPick: res.nextPick ?? "（前兩手不足）",
    tpP: res.tpP,
    tpB: res.tpB,
    ts: Date.now()
  });

  setText("thisWin", win);
  setText("nextPick", res.nextPick ?? "（前兩手不足）");
  setText("lastOut", win);

  saveState();
  render();
}

// ---- UI render ----
function render(){
  const st = state.stats;
  setText("handNo", st.handNo.toString());
  setText("wlt", `${st.bankerWins} / ${st.playerWins} / ${st.ties}`);
  setText("pickStats", `${st.pickWins} / ${st.pickLosses} / ${st.pickTies} / ${st.pickSkipped}`);

  // 近7局主注（課程規則 v1.39：贏即重置目前進度；累積6勝=完成課程；只計贏/輸）
  const cw = state.stats.courseWins ?? 0;
  const prog = state.stats.courseProgress ?? 0;
  const done = state.stats.courseDone || cw >= 6;
  setText("pick7", done ? "完成課程" : `課程進度：${cw} / 6`);
  setText("pick7Prog", `目前進度：${prog} / 7`);

  if (!state.log.length){
    setText("thisWin", "—");
    setText("nextPick", state.pendingPick ?? "—");
    setText("lastOut", "—");
  }else{
    setText("thisWin", state.log[0].win);
    setText("nextPick", state.log[0].nextPick);
    setText("lastOut", state.log[0].win);
  }

  const logEl = document.getElementById("log");
  if (logEl){
    logEl.innerHTML = "";
    for (let i=0;i<state.log.length;i++){ const row = state.log[i];
      const div = document.createElement("div");
      div.className = "line";
      const pillClass = row.win==="莊家" ? "good" : (row.win==="閒家" ? "bad" : "");
      div.innerHTML = `
        <div class="log-head"><div class="mono log-left"><b>第${row.n}局</b>
          <span class="pill ${pillClass}">${row.win}</span>
          <span class="pill">上局建議：${row.prevPick}</span>
          <span class="pill">結果：${row.prevPickResult}</span>
          <span class="pill">下局：${row.nextPick}</span>
        </div>${i===0?'<button class="pill btn undo-btn" data-action="undoHand">撤銷本局</button>':''}</div>
        <div class="mono muted" style="margin-top:6px;">
          輸入：${escapeHtml(row.input)}<br/>
          點數：閒=${row.pTotal} 莊=${row.bTotal}<br/>
          TP：閒=${row.tpP==null?"（無）":escapeHtml(fmt(row.tpP))} ｜ 莊=${row.tpB==null?"（無）":escapeHtml(fmt(row.tpB))}
        </div>
      `;
      logEl.appendChild(div);
    }
  }

  updateCourseStatusUI();

  renderKeypad();
}

function escapeHtml(s){
  return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
}

// ---- keypad UI ----
function renderKeypad(){
  // Auto decide which side to input next
  const nextSide = expectedSide();
  state.keypad.side = nextSide || "P";

  setHandChips("pCardsDisp", state.keypad.p, "P");
  setHandChips("bCardsDisp", state.keypad.b, "B");
  const sideP = document.getElementById("sidePlayer");
  const sideB = document.getElementById("sideBanker");
  if (sideP && sideB){
    if (nextSide === "P"){
      sideP.classList.add("primary");
      sideB.classList.remove("primary");
      const pHint = document.getElementById("pHint"); if (pHint) pHint.textContent = "正在輸入";
      const bHint = document.getElementById("bHint"); if (bHint) bHint.textContent = "";
    }else if (nextSide === "B"){
      sideB.classList.add("primary");
      sideP.classList.remove("primary");
      const bHint = document.getElementById("bHint"); if (bHint) bHint.textContent = "正在輸入";
      const pHint = document.getElementById("pHint"); if (pHint) pHint.textContent = "";
    }else{
      // no more cards
      sideP.classList.remove("primary");
      sideB.classList.remove("primary");
      const pHint = document.getElementById("pHint"); if (pHint) pHint.textContent = "";
      const bHint = document.getElementById("bHint"); if (bHint) bHint.textContent = "";
    }
  }

  const pad = document.getElementById("cardPad");
  if (pad && !pad.dataset.ready){
    const labels = [
      {v:1, t:"A"},{v:2,t:"2"},{v:3,t:"3"},{v:4,t:"4"},{v:5,t:"5"},{v:6,t:"6"},{v:7,t:"7"},
      {v:8,t:"8"},{v:9,t:"9"},{v:10,t:"10"},{v:11,t:"J"},{v:12,t:"Q"},{v:13,t:"K"},
      {v:"BACK", t:"⌫"}
    ];
    for (const it of labels){
      const btn = document.createElement("button");
      btn.className = "key";
      btn.type = "button";
      btn.dataset.v = String(it.v);

      const txt = document.createElement("span");
      txt.className = "keyText";
      txt.textContent = it.t;
      btn.appendChild(txt);

      const wrap = document.createElement("span");
      wrap.className = "badgeWrap";
      btn.appendChild(wrap);

      if (it.v === "BACK"){
        btn.classList.add("keyBack");
        btn.addEventListener("click", ()=>{
          keypadBackspace();
          saveState();
          renderKeypad();
        });
      }else{
        btn.addEventListener("click", ()=>{
          const side = expectedSide();
          if (!side){
            alert("依百家樂補牌規則，本局不需要再補牌");
            return;
          }
          if (side === "P"){
            if (state.keypad.p.length < 3){
              state.keypad.p.push(it.v);
              state.keypad.seq.push("P");
            }
          }else{
            if (state.keypad.b.length < 3){
              state.keypad.b.push(it.v);
              state.keypad.seq.push("B");
            }
          }
          saveState();
          renderKeypad();
        });
      }

      pad.appendChild(btn);
    }
    pad.dataset.ready = "1";
  }

  updateKeyBadges();
  updateInputStatus();
}

function updateKeyBadges(){
  const pad = document.getElementById("cardPad");
  if (!pad) return;
  const btns = pad.querySelectorAll("button.key");
  const p = state.keypad.p || [];
  const b = state.keypad.b || [];
  const pThird = p.length >= 3 ? p[2] : null;
  const bThird = b.length >= 3 ? b[2] : null;

  const countMap = new Map();
  for (const v of [...p, ...b]) countMap.set(v, (countMap.get(v)||0)+1);

  for (const btn of btns){
    const raw = btn.dataset.v || "";
    if (raw === "BACK") continue;

    const v = Number(raw);
    btn.classList.remove("selected");
    const wrap = btn.querySelector(".badgeWrap");
    if (wrap) wrap.innerHTML = "";

    const badges = [];

    const inP = p.includes(v);
    const inB = b.includes(v);

    if (inP || inB) btn.classList.add("selected");

    if (inP) badges.push({t:"閒", cls:"badgeP"});
    if (inB) badges.push({t:"莊", cls:"badgeB"});

    if (v === pThird || v === bThird) badges.push({t:"補", cls:"badgeS"});

    const c = countMap.get(v);
    if (c && c > 1) badges.push({t:`x${c}`, cls:"badgeN"});

    if (wrap && badges.length){
      for (const bd of badges){
        const s = document.createElement("span");
        s.className = "badge " + bd.cls;
        s.textContent = bd.t;
        wrap.appendChild(s);
      }
    }
  }
}


function keypadBackspace(){
  state.keypad.seq = state.keypad.seq || [];
  const last = state.keypad.seq.pop();
  if (last === "P"){
    state.keypad.p.pop();
  }else if (last === "B"){
    state.keypad.b.pop();
  }else{
    // fallback
    if ((state.keypad.b||[]).length > (state.keypad.p||[]).length) state.keypad.b.pop();
    else state.keypad.p.pop();
  }
}

function keypadClearSide(){
  // auto mode: clear the side that is currently expected
  const side = expectedSide() || "P";
  if (side === "P"){
    // remove any player cards and rebuild seq
    state.keypad.p = [];
  }else{
    state.keypad.b = [];
  }
  // rebuild seq based on counts: P P B B [P] [B]
  state.keypad.seq = [];
  for (let i=0;i<state.keypad.p.length;i++) state.keypad.seq.push("P");
  for (let i=0;i<state.keypad.b.length;i++) state.keypad.seq.push("B");
}

function keypadClearBoth(){
  state.keypad.p = [];
  state.keypad.b = [];
  state.keypad.seq = [];
}

function keypadSubmit(){
  const p = state.keypad.p || [];
  const b = state.keypad.b || [];
  if (p.length < 2 || b.length < 2){
    alert("請先輸入閒家兩張、莊家兩張");
    return;
  }
  const next = expectedSide();
  if (next === "P"){
    alert("依補牌規則，閒家需要補一張");
    return;
  }
  if (next === "B"){
    alert("依補牌規則，莊家需要補一張");
    return;
  }
  const line = `${p.join(".")} ${b.join(".")}`;
  submit(line);
  keypadClearBoth();
  saveState();
  render();
}


// ---- bind DOM ----
onEvent("submitBtn","click", ()=>{
  const v = document.getElementById("handInput").value;
  document.getElementById("handInput").value = "";
  try{ submit(v); }catch(e){ alert(e.message || String(e)); }
});
onEvent("handInput","keydown", (e)=>{
  if (e.key === "Enter"){
    const v = document.getElementById("handInput").value;
    document.getElementById("handInput").value = "";
    try{ submit(v); }catch(err){ alert(err.message || String(err)); }
  }
});
onEvent("undoBtn","click", ()=>{
  const r = cmdUndo(); if (!r.ok) alert(r.msg); else setText("lastOut", r.msg);
  saveState(); render();
});
onEvent("redoBtn","click", ()=>{
  const r = cmdRedo(); if (!r.ok) alert(r.msg); else setText("lastOut", r.msg);
  saveState(); render();
});
onEvent("resetBtn","click", ()=>{
  if (!confirm("確定要重置嗎？（新靴/洗牌用）")) return;
  const r = cmdReset(); setText("lastOut", r.msg);
});
onEvent("clearBtn","click", ()=>{
  if (!confirm("確定要清除紀錄嗎？（只清除最下方紀錄，不影響局數/統計）")) return;
  const r = cmdClearLog(); setText("lastOut", r.msg);
});

onEvent("sidePlayer","click", ()=>{ /* auto mode */ });
onEvent("sideBanker","click", ()=>{ /* auto mode */ });
onEvent("bkspBtn","click", ()=>{
  keypadBackspace(); saveState(); renderKeypad();
});
onEvent("clearSideBtn","click", ()=>{
  keypadClearSide(); saveState(); renderKeypad();
});
onEvent("clearBothBtn","click", ()=>{
  keypadClearBoth(); saveState(); renderKeypad();
});
onEvent("submitKeypadBtn","click", ()=>{
  try{ keypadSubmit(); }catch(e){ alert(e.message || String(e)); }
});


function updateTabUI(){
  const bar = document.getElementById("tabbar");
  if (!bar) return;
  for (const btn of bar.querySelectorAll("button[data-tab]")){
    const t = (btn.getAttribute("data-tab")||"").toUpperCase();
    btn.classList.toggle("active", t === activeTab);
  }
}
function switchTab(tab){
  const t = (tab||"").toUpperCase();
  if (!TABS.includes(t) || t === activeTab) return;
  // save current
  saveState();
  activeTab = t;
  localStorage.setItem(ACTIVE_TAB_KEY, activeTab);
  // load new
  state = loadState(activeTab) ?? newState();
  ensureStateFixups();
  updateTabUI();
  renderKeypad();
  render();
  updateCourseStatusUI();
}
// bind tab clicks
document.addEventListener("click", (e)=>{
  const btn = e.target && e.target.closest ? e.target.closest("#tabbar button[data-tab]") : null;
  if (!btn) return;
  switchTab(btn.getAttribute("data-tab"));
});
document.addEventListener("DOMContentLoaded", ()=>{ updateTabUI(); });


// ---- CSV Export (v1.47) ----
function toIsoDateTime(ts){
  try{
    const d = new Date(ts || Date.now());
    const pad = (n)=> String(n).padStart(2,"0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }catch{ return ""; }
}
function csvEscape(v){
  const s = (v==null) ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
  return s;
}
function buildCSVForState(st){
  const header = ["局號","輸入","閒點","莊點","本局勝利","上局建議","上局結果","下局建議","時間"];
  const rows = [header];
  const log = Array.isArray(st.log) ? st.log : [];
  // export oldest -> newest
  const ordered = [...log].reverse();
  for (const r of ordered){
    rows.push([
      r.n ?? "",
      r.input ?? "",
      r.pTotal ?? "",
      r.bTotal ?? "",
      r.win ?? "",
      r.prevPick ?? "",
      r.prevPickResult ?? "",
      r.nextPick ?? "",
      toIsoDateTime(r.ts)
    ]);
  }
  return rows.map(cols => cols.map(csvEscape).join(",")).join("\n");
}
function isCourseDone(){
  const cw = state.stats?.courseWins ?? 0;
  return !!(state.stats && (state.stats.courseDone || cw >= 6));
}
function updateCourseStatusUI(){
  const statusEl = document.getElementById("courseStatus");
  const btn = document.getElementById("downloadCsvBtn");
  const cw = state.stats?.courseWins ?? 0;
  const done = isCourseDone();
  const shown = Math.min(cw, 6);
  if (statusEl){
    statusEl.textContent = done ? `課程狀態：已完成（${shown} / 6）` : `課程狀態：未完成（${shown} / 6）`;
  }
  if (btn){
    btn.disabled = !done;
    btn.textContent = `下載紀錄（${activeTab}）`;
  }
}
function downloadCSVForActiveTab(){
  if (!isCourseDone()){
    alert("課程未完成（6/6）時不可下載紀錄");
    return;
  }
  const csv = "\ufeff" + buildCSVForState(state); // BOM for Excel
  const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);

  const pad = (n)=> String(n).padStart(2,"0");
  const d = new Date();
  const dateStr = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const filename = `Monster_v1.47_Tab${activeTab}_${dateStr}.csv`;

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 5000);
}
document.addEventListener("DOMContentLoaded", ()=>{
  const btn = document.getElementById("downloadCsvBtn");
  if (btn){
    btn.addEventListener("click", ()=>{
      try{ downloadCSVForActiveTab(); }catch(e){ alert(e.message || String(e)); }
    });
  }
});

// 初次載入
render();

// show version in case HTML didn't include it
document.addEventListener("DOMContentLoaded", ()=>{
  const vb = document.getElementById("verBadge");
  if (vb) vb.textContent = BUILD_VERSION;
});

document.addEventListener("DOMContentLoaded", ()=>{
  on("resetShoeBtn", ()=>{
    cmdReset();
  });
  on("clearLogBtn", ()=>{
    cmdClearLog();
  });
});


document.addEventListener("DOMContentLoaded", ()=>{
  const logEl = document.getElementById("log");
  if (logEl){
    logEl.addEventListener("click", (e)=>{
      const t = e.target;
      const btn = t && t.closest ? t.closest('[data-action="undoHand"]') : null;
      if (btn){
        e.preventDefault();
        cmdUndoHand();
      }
    });
  }
});





document.addEventListener("DOMContentLoaded", ()=>{
  const btn = document.getElementById("downloadCsvBtn");
  if(btn){
    btn.addEventListener("click", downloadCSVForActiveTab);
  }
});
