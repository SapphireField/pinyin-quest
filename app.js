/* Pinyin Quest (Web)
   - Browser-only, no build step.
   - Data stored in localStorage.
   - Kid-friendly horror ambience + Door-run levels.
*/

const LS_KEY = 'pinyin_quest_v1';

function todayISO(){
  const d = new Date();
  const tzOff = d.getTimezoneOffset();
  const local = new Date(d.getTime() - tzOff*60*1000);
  return local.toISOString().slice(0,10);
}

function clamp(n,min,max){ return Math.max(min, Math.min(max,n)); }
function randInt(a,b){ return Math.floor(Math.random()*(b-a+1))+a; }

function loadState(){
  const raw = localStorage.getItem(LS_KEY);
  if(!raw){
    return defaultState();
  }
  try{
    const s = JSON.parse(raw);
    return migrateState(s);
  }catch{
    return defaultState();
  }
}

function saveState(s){
  localStorage.setItem(LS_KEY, JSON.stringify(s));
}

function defaultState(){
  const demoLesson = makeDemoLesson();
  return {
    settings: { scareLevel: 'low', showHanzi: false },
    economy: { coins: 0, keys: 0, battery: 100 },
    streak: { count: 0, lastComplete: null, freezeTokens: 2, usedFreezeThisMonth: 0, month: (new Date()).getMonth() },
    worlds: [demoLesson],
    activeWorldId: demoLesson.id,
    progression: {
      // per-world room progress
      // worldId: { unlockedRoom: 1, completedRooms: { [roomNo]: true }, bestTimeTrialMs: null }
    },
    srs: {
      // vocab itemId -> { interval: number (days), due: ISO, ease: number }
    }
  };
}

function migrateState(s){
  // minimal future-proofing
  if(!s.settings) s.settings = { scareLevel:'low', showHanzi:false };
  if(!s.economy) s.economy = { coins:0, keys:0, battery:100 };
  if(!s.streak) s.streak = { count:0, lastComplete:null, freezeTokens:2, usedFreezeThisMonth:0, month:(new Date()).getMonth() };
  if(!Array.isArray(s.worlds) || s.worlds.length===0){
    s.worlds = [makeDemoLesson()];
    s.activeWorldId = s.worlds[0].id;
  }
  if(!s.activeWorldId) s.activeWorldId = s.worlds[0].id;
  if(!s.progression) s.progression = {};
  if(!s.srs) s.srs = {};
  return s;
}

function makeId(prefix='id'){
  return prefix + '_' + Math.random().toString(16).slice(2) + '_' + Date.now().toString(16);
}

function makeDemoLesson(){
  return {
    id: makeId('world'),
    title: 'World 1 (Demo) — Haunted Corridor',
    weekLabel: 'Demo Week',
    phonicsFocus: ['zh','ch','sh','r'],
    vocab: [
      { id: makeId('v'), hanzi:'池塘', pinyin:'chí táng', meaning:'pond' },
      { id: makeId('v'), hanzi:'蜻蜓', pinyin:'qīng tíng', meaning:'dragonfly' },
      { id: makeId('v'), hanzi:'草坪', pinyin:'cǎo píng', meaning:'lawn' },
      { id: makeId('v'), hanzi:'荷叶', pinyin:'hé yè', meaning:'lotus leaf' },
      { id: makeId('v'), hanzi:'笑嘻嘻', pinyin:'xiào xī xī', meaning:'grinning' },
    ],
    characters: [
      { hanzi:'池', pinyin:'chí' },
      { hanzi:'塘', pinyin:'táng' },
      { hanzi:'蜻', pinyin:'qīng' },
      { hanzi:'蜓', pinyin:'tíng' },
      { hanzi:'坪', pinyin:'píng' },
    ],
    patterns: { abb: ['亮晶晶','笑嘻嘻','绿油油'] },
    grammarPoints: [{ type:'simile', example:'荷叶像我的摇篮。', note:'“像…一样” / “像…” is a simile pattern.' }],
    textLines: [
      { hanzi:'荷叶圆圆的，绿绿的。', pinyin:'hé yè yuán yuán de, lǜ lǜ de.' },
      { hanzi:'小水珠说：“荷叶是我的摇篮。”', pinyin:'xiǎo shuǐ zhū shuō: “hé yè shì wǒ de yáo lán.”' },
      { hanzi:'小蜻蜓说：“荷叶是我的停机坪。”', pinyin:'xiǎo qīng tíng shuō: “hé yè shì wǒ de tíng jī píng.”' },
    ]
  };
}

function getActiveWorld(state){
  return state.worlds.find(w=>w.id===state.activeWorldId) || state.worlds[0];
}

function ensureWorldProgress(state, worldId){
  if(!state.progression[worldId]){
    state.progression[worldId] = { unlockedRoom: 1, completedRooms: {}, bestTimeTrialMs: null };
  }
  return state.progression[worldId];
}

function resetMonthlyFreezeIfNeeded(state){
  const m = (new Date()).getMonth();
  if(state.streak.month !== m){
    state.streak.month = m;
    state.streak.usedFreezeThisMonth = 0;
    state.streak.freezeTokens = 2;
  }
}

function bumpStreakIfEligible(state){
  // Streak increments once per day when a room is completed.
  resetMonthlyFreezeIfNeeded(state);
  const today = todayISO();
  const last = state.streak.lastComplete;
  if(last === today) return; // already counted

  if(!last){
    state.streak.count = 1;
    state.streak.lastComplete = today;
    return;
  }

  const lastDate = new Date(last+'T00:00:00');
  const todayDate = new Date(today+'T00:00:00');
  const diffDays = Math.round((todayDate - lastDate)/(24*3600*1000));

  if(diffDays === 1){
    state.streak.count += 1;
    state.streak.lastComplete = today;
  }else if(diffDays > 1){
    // attempt freeze token to preserve streak
    if(state.streak.freezeTokens > 0 && state.streak.usedFreezeThisMonth < 2){
      state.streak.freezeTokens -= 1;
      state.streak.usedFreezeThisMonth += 1;
      // keep streak count, but set lastComplete to today
      state.streak.lastComplete = today;
      toast(`Used a Freeze Token to protect the streak. (${state.streak.freezeTokens} left)`);
    }else{
      state.streak.count = 1;
      state.streak.lastComplete = today;
    }
  }
}

function grantDailyReward(state){
  // Simple daily reward on first completion of the day.
  // Coins scale mildly with streak, plus small battery refill.
  const baseCoins = 12;
  const bonus = clamp(Math.floor(state.streak.count/3)*3, 0, 24);
  const coins = baseCoins + bonus;
  state.economy.coins += coins;
  state.economy.battery = clamp(state.economy.battery + 10, 0, 100);
  state.economy.keys += 1;
  toast(`Daily prize: +${coins} coins, +1 key, +10 battery.`);
}

function milestoneReward(state){
  const s = state.streak.count;
  if([3,7,14,30,60].includes(s)){
    state.economy.coins += 50;
    state.economy.keys += 2;
    toast(`Streak milestone ${s}! Bonus: +50 coins, +2 keys.`);
  }
}

function scheduleSRS(state, itemId, correct){
  const now = todayISO();
  const entry = state.srs[itemId] || { interval: 1, due: now, ease: 2.3 };
  if(correct){
    entry.ease = clamp(entry.ease + 0.05, 1.3, 3.0);
    entry.interval = clamp(Math.round(entry.interval * entry.ease), 1, 60);
  }else{
    entry.ease = clamp(entry.ease - 0.15, 1.3, 3.0);
    entry.interval = 1;
  }
  const dueDate = new Date(now+'T00:00:00');
  dueDate.setDate(dueDate.getDate() + entry.interval);
  entry.due = dueDate.toISOString().slice(0,10);
  state.srs[itemId] = entry;
}

function pickDueVocab(state, world, n=4){
  const today = todayISO();
  const due = [];
  for(const v of world.vocab){
    const entry = state.srs[v.id];
    if(!entry || entry.due <= today){
      due.push(v);
    }
  }
  // fallback if not enough due
  const pool = due.length >= n ? due : [...due, ...world.vocab];
  const out = [];
  const used = new Set();
  while(out.length < n && pool.length>0){
    const idx = randInt(0, pool.length-1);
    const v = pool[idx];
    if(used.has(v.id)) continue;
    used.add(v.id);
    out.push(v);
  }
  return out;
}

function roomType(roomNo){
  if(roomNo % 10 === 0) return 'secret';
  if(roomNo % 5 === 0) return 'boss';
  const types = ['vocab','sound','reading','pattern'];
  return types[(roomNo-1) % types.length];
}

// ------- UI / Routing -------

const appEl = document.getElementById('app');
let STATE = loadState();

window.addEventListener('hashchange', render);

function nav(path){
  location.hash = path;
}

function h(tag, attrs={}, children=[]){
  const el = document.createElement(tag);
  for(const [k,v] of Object.entries(attrs||{})){
    if(k==='class') el.className = v;
    else if(k==='html') el.innerHTML = v;
    else if(k.startsWith('on') && typeof v==='function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v);
  }
  for(const c of children){
    if(c==null) continue;
    el.appendChild(typeof c==='string' ? document.createTextNode(c) : c);
  }
  return el;
}

let toastTimer = null;
function toast(msg){
  let el = document.querySelector('.toast');
  if(!el){
    el = h('div', {class:'toast'});
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>el.classList.add('hidden'), 3200);
}

function renderHeader(){
  const world = getActiveWorld(STATE);
  return h('div',{class:'header'},[
    h('div',{class:'brand'},[
      h('div',{class:'logo'}),
      h('div',{class:'title'},[
        h('h1',{},['Pinyin Quest']),
        h('p',{},[`${world.title} • ${world.weekLabel}`])
      ])
    ]),
    h('div',{class:'nav'},[
      h('button',{class:'btn primary', onClick:()=>nav('#/')},['Door Run']),
      h('button',{class:'btn', onClick:()=>nav('#/import')},['Lesson Import']),
      h('button',{class:'btn', onClick:()=>nav('#/stats')},['Stats']),
      h('button',{class:'btn', onClick:()=>nav('#/settings')},['Settings']),
    ])
  ]);
}

function render(){
  const route = (location.hash || '#/').slice(2);
  appEl.innerHTML = '';
  appEl.appendChild(renderHeader());

  if(route.startsWith('room/')){
    const roomNo = parseInt(route.split('/')[1],10);
    appEl.appendChild(renderRoom(roomNo));
  }else if(route==='import'){
    appEl.appendChild(renderImport());
  }else if(route==='stats'){
    appEl.appendChild(renderStats());
  }else if(route==='settings'){
    appEl.appendChild(renderSettings());
  }else{
    appEl.appendChild(renderDashboard());
  }
}

// ------- Pages -------

function renderDashboard(){
  const world = getActiveWorld(STATE);
  const prog = ensureWorldProgress(STATE, world.id);

  const streak = STATE.streak;
  const eco = STATE.economy;

  const unlocked = prog.unlockedRoom;
  const totalRooms = 50; // per world (easy to increase)
  const pct = Math.round((unlocked-1)/totalRooms*100);

  const left = h('div',{class:'card'},[
    h('h2',{},['Door Run (Levels)']),
    h('p',{},['Clear rooms to unlock the next door. Every 5 rooms is a Boss Review. Room 10/20/30/40/50 are Secret Rooms (need keys).']),
    h('div',{style:'margin-top:10px; display:flex; gap:10px; flex-wrap:wrap;'},[
      h('span',{class:'pill'},[`Unlocked: Room ${unlocked} / ${totalRooms}`]),
      h('span',{class:'pill'},[`Keys: ${eco.keys}`]),
      h('span',{class:'pill'},[`Battery: ${eco.battery}%`]),
      h('span',{class:'pill'},[`Coins: ${eco.coins}`]),
    ]),
    h('div',{style:'margin-top:10px;'},[
      h('div',{class:'progress'},[h('div',{style:`width:${pct}%`})]),
      h('div',{class:'small', style:'margin-top:6px;'},[`Progress: ${pct}%`])
    ]),
    h('div',{class:'doors'}, renderDoorGrid(totalRooms, unlocked, prog)),
  ]);

  const right = h('div',{class:'card'},[
    h('h2',{},['Daily Streak & Prizes']),
    h('p',{},['Complete at least one room per day to keep your streak. Freeze tokens protect your streak if you miss days.']),
    h('div',{class:'kpiRow'},[
      h('div',{class:'kpi'},[h('div',{class:'label'},['Current streak']), h('div',{class:'big'},[String(streak.count)])]),
      h('div',{class:'kpi'},[h('div',{class:'label'},['Last completed']), h('div',{class:'big'},[streak.lastComplete? streak.lastComplete : '—'])]),
      h('div',{class:'kpi'},[h('div',{class:'label'},['Freeze tokens']), h('div',{class:'big'},[String(streak.freezeTokens)])]),
    ]),
    h('hr'),
    h('h2',{},['Daily Time Trial (Solo)']),
    h('p',{},['Beat your best time to earn extra coins.']),
    h('button',{class:'btn primary', onClick:()=>nav('#/room/999')},['Start Time Trial']),
    h('div',{class:'small', style:'margin-top:8px;'},[
      `Best time: ${prog.bestTimeTrialMs ? (prog.bestTimeTrialMs/1000).toFixed(2)+'s' : '—'}`
    ])
  ]);

  return h('div',{class:'grid'},[left,right]);
}

function renderDoorGrid(totalRooms, unlocked, prog){
  const world = getActiveWorld(STATE);
  const cells = [];
  for(let i=1;i<=totalRooms;i++){
    const t = roomType(i);
    const isLocked = i > unlocked;
    const isCompleted = !!prog.completedRooms[i];

    // Secret rooms require a key to enter (unless already completed)
    const isSecret = t==='secret';
    const needsKey = isSecret && !isCompleted;

    let cls = 'door';
    if(isLocked) cls += ' locked';
    if(t==='boss') cls += ' boss';
    if(isSecret) cls += ' secret';

    const tag = t==='boss' ? 'BOSS' : (t==='secret' ? 'SECRET' : t.toUpperCase());

    const door = h('div',{class:cls, onClick:()=>{
      if(isLocked) return;
      if(needsKey && STATE.economy.keys<=0){
        toast('Need a key to enter this Secret Room.');
        return;
      }
      nav(`#/room/${i}`);
    }},[
      h('div',{class:'num'},[`#${i}`]),
      h('div',{class:'tag'},[tag + (isCompleted ? ' ✓' : '')]),
      h('div',{class:'knob'}),
    ]);

    // Add subtle tooltip via title
 it's okay
    door.setAttribute('title', describeRoom(i, world));
    cells.push(door);
  }
  return cells;
}

function describeRoom(roomNo, world){
  const t = roomType(roomNo);
  if(roomNo===999) return 'Time Trial: 3 quick questions';
  switch(t){
    case 'vocab': return 'Vocab Loot: pinyin ↔ meaning';
    case 'sound': return `Sound Boss: ${world.phonicsFocus?.join('/') || 'phonics'}`;
    case 'reading': return 'Read Aloud: pinyin-first, optional hanzi toggle';
    case 'pattern': return 'Pattern Quest: ABB words & short forms';
    case 'boss': return 'Boss Review: mixed review (SRS)';
    case 'secret': return 'Secret Room: extra rewards';
    default: return 'Quest';
  }
}

function renderRoom(roomNo){
  const world = getActiveWorld(STATE);
  const prog = ensureWorldProgress(STATE, world.id);

  if(roomNo === 999){
    return renderTimeTrial(world, prog);
  }

  const t = roomType(roomNo);
  const isSecret = t==='secret';
  const alreadyCompleted = !!prog.completedRooms[roomNo];
  if(isSecret && !alreadyCompleted){
    // Spend a key to enter
    STATE.economy.keys = Math.max(0, STATE.economy.keys - 1);
    saveState(STATE);
  }

  let content;
  if(t==='vocab') content = vocabQuest(world, {mixed:false});
  else if(t==='sound') content = soundQuest(world);
  else if(t==='reading') content = readingQuest(world);
  else if(t==='pattern') content = patternQuest(world);
  else if(t==='boss') content = vocabQuest(world, {mixed:true});
  else if(t==='secret') content = secretRewardQuest(world);

  const header = h('div',{class:'card'},[
    h('h2',{},[`Room #${roomNo} — ${t.toUpperCase()}`]),
    h('p',{},[describeRoom(roomNo, world)]),
  ]);

  const wrap = h('div',{},[header, content]);
  return wrap;
}

function completeRoom(worldId, roomNo, extra={}){
  const prog = ensureWorldProgress(STATE, worldId);
  const firstTime = !prog.completedRooms[roomNo];
  prog.completedRooms[roomNo] = true;

  // Unlock next room
  if(roomNo >= prog.unlockedRoom){
    prog.unlockedRoom = Math.min(roomNo+1, 9999);
  }

  // economy rewards
  const base = 8;
  const bonus = (roomType(roomNo)==='boss') ? 6 : 0;
  const secret = (roomType(roomNo)==='secret') ? 10 : 0;
  const coins = base + bonus + secret;
  STATE.economy.coins += coins;

  // streak handling only on first completion that day
  const before = STATE.streak.lastComplete;
  bumpStreakIfEligible(STATE);
  if(STATE.streak.lastComplete !== before){
    grantDailyReward(STATE);
    milestoneReward(STATE);
  }

  saveState(STATE);
  toast(`Room cleared! +${coins} coins.`);
}

function vocabQuest(world, opts){
  const mixed = !!opts.mixed;
  const promptMode = (Math.random() < 0.5) ? 'p2m' : 'm2p';
  const items = pickDueVocab(STATE, world, 4);

  // pick target
  const target = items[randInt(0, items.length-1)];
  const choices = shuffle(items.slice());

  const promptText = (promptMode==='p2m')
    ? `What does “${target.pinyin}” mean?`
    : `Which pinyin matches “${STATE.settings.showHanzi ? target.hanzi : target.meaning}” ?`;

  const wrap = h('div',{class:'card'},[
    h('h2',{},[mixed ? 'Boss Review — Vocab' : 'Vocab Loot']),
    h('div',{class:'quiz'},[
      h('div',{class:'question'},[
        h('div',{class:'prompt'},[promptText]),
        STATE.settings.showHanzi ? h('div',{class:'small'},[`Hanzi: ${target.hanzi} • Meaning: ${target.meaning}`]) : h('div',{class:'small'},[`Tip: toggle Hanzi in Settings if needed.`]),
      ]),
      h('div',{class:'choices'}, choices.map(c=>{
        const label = (promptMode==='p2m') ? c.meaning : c.pinyin;
        return h('div',{class:'choice', onClick:()=>{
          const isCorrect = c.id === target.id;
          markChoice(isCorrect, c.id);
          scheduleSRS(STATE, target.id, isCorrect);
        }},[label]);
      }))
    ]),
    h('div',{class:'footerBar', style:'margin-top:10px;'},[
      h('button',{class:'btn', onClick:()=>nav('#/')},['Back']),
      h('button',{class:'btn primary', id:'finishBtn', onClick:()=>{
        completeRoom(world.id, currentRoomNo());
        nav('#/');
      }},['Finish Room'])
    ])
  ]);

  let answered = false;
  function markChoice(isCorrect){
    if(answered) return;
    answered = true;
    const nodes = wrap.querySelectorAll('.choice');
    nodes.forEach(n=>{
      const txt = n.textContent;
      const match = (promptMode==='p2m') ? (txt===target.meaning) : (txt===target.pinyin);
      if(match) n.classList.add('correct');
    });
    if(!isCorrect){
      // mark clicked wrong
      // best-effort
      toast('Not quite. Review and finish the room.');
    }else{
      toast('Correct!');
    }
  }

  // In boss mode, we can show a second quick question to increase value.
  if(mixed){
    const extra = h('div',{class:'question'},[
      h('div',{class:'prompt'},['Bonus: pick the correct meaning for another word.']),
      h('div',{class:'small'},[`Word: ${items[0].pinyin}`])
    ]);
    wrap.querySelector('.quiz').appendChild(extra);
  }

  return wrap;
}

function soundQuest(world){
  const focus = world.phonicsFocus && world.phonicsFocus.length ? world.phonicsFocus : ['zh','ch','sh','r'];
  const syllables = [
    { p:'zhī', g:'zh' }, { p:'chī', g:'ch' }, { p:'shī', g:'sh' }, { p:'rì', g:'r' },
    { p:'zhǎo', g:'zh' }, { p:'chén', g:'ch' }, { p:'shǒu', g:'sh' }, { p:'rén', g:'r' },
  ];
  const target = syllables[randInt(0, syllables.length-1)];
  const choices = shuffle([...new Set([target.g, ...focus])]).slice(0,4);
  while(choices.length<4) choices.push(focus[randInt(0, focus.length-1)]);
  shuffle(choices);

  const wrap = h('div',{class:'card'},[
    h('h2',{},['Sound Boss']),
    h('p',{},['Choose the sound family for the syllable. (Audio can be added later; this MVP trains recognition.)']),
    h('div',{class:'question'},[
      h('div',{class:'prompt'},[`Syllable: ${target.p}`]),
      h('div',{class:'choices'}, choices.map(c=>h('div',{class:'choice', onClick:()=>{
        const ok = c===target.g;
        toast(ok ? 'Correct!' : 'Try again next time.');
        scheduleSoundReward(ok);
        mark(ok, c);
      }},[c])))
    ]),
    h('div',{class:'footerBar', style:'margin-top:10px;'},[
      h('button',{class:'btn', onClick:()=>nav('#/')},['Back']),
      h('button',{class:'btn primary', onClick:()=>{ completeRoom(world.id, currentRoomNo()); nav('#/'); }},['Finish Room'])
    ])
  ]);

  function mark(ok, picked){
    const nodes = wrap.querySelectorAll('.choice');
    nodes.forEach(n=>{
      if(n.textContent===target.g) n.classList.add('correct');
      if(n.textContent===picked && !ok) n.classList.add('wrong');
    });
  }
  function scheduleSoundReward(ok){
    // light reward to encourage
    if(ok) STATE.economy.coins += 2;
    saveState(STATE);
  }
  return wrap;
}

function readingQuest(world){
  const lines = world.textLines?.length ? world.textLines : [{hanzi:'',pinyin:'(No text yet. Import a lesson in Lesson Import.)'}];
  const idx = randInt(0, lines.length-1);
  const line = lines[idx];

  const showH = STATE.settings.showHanzi;

  const wrap = h('div',{class:'card'},[
    h('h2',{},['Read Aloud (Pinyin-first)']),
    h('p',{},['Read the line aloud. This MVP lets you record and playback your own voice. (Reference audio can be added later.)']),
    h('div',{class:'question'},[
      h('div',{class:'prompt'},[line.pinyin]),
      showH ? h('div',{class:'small'},[line.hanzi]) : h('div',{class:'small'},['(Hanzi hidden — toggle in Settings)'])
    ]),
    recorderUI(),
    h('div',{class:'footerBar', style:'margin-top:10px;'},[
      h('button',{class:'btn', onClick:()=>nav('#/')},['Back']),
      h('button',{class:'btn primary', onClick:()=>{ completeRoom(world.id, currentRoomNo()); nav('#/'); }},['Finish Room'])
    ])
  ]);
  return wrap;
}

function recorderUI(){
  const box = h('div',{class:'card', style:'padding:12px; background:rgba(0,0,0,.18); border-color:rgba(255,255,255,.10);'},[
    h('h2',{},['Recorder']),
    h('p',{},['Click Record, read once, then Stop. You can play it back.'])
  ]);

  const status = h('div',{class:'small'},['Mic idle.']);
  const audio = h('audio',{controls:true, style:'width:100%; margin-top:8px;'});
  audio.classList.add('hidden');

  const btnRow = h('div',{style:'display:flex; gap:10px; flex-wrap:wrap; margin-top:10px;'},[]);
  const recBtn = h('button',{class:'btn primary'},['Record']);
  const stopBtn = h('button',{class:'btn'},['Stop']);
  stopBtn.disabled = true;

  btnRow.appendChild(recBtn);
  btnRow.appendChild(stopBtn);

  box.appendChild(btnRow);
  box.appendChild(status);
  box.appendChild(audio);

  let mediaRecorder = null;
  let chunks = [];

  recBtn.addEventListener('click', async ()=>{
    try{
      const stream = await navigator.mediaDevices.getUserMedia({audio:true});
      mediaRecorder = new MediaRecorder(stream);
      chunks = [];
      mediaRecorder.ondataavailable = e=>chunks.push(e.data);
      mediaRecorder.onstop = ()=>{
        const blob = new Blob(chunks, {type:'audio/webm'});
        audio.src = URL.createObjectURL(blob);
        audio.classList.remove('hidden');
        status.textContent = 'Recording saved. Play it back.';
        // stop tracks
        stream.getTracks().forEach(t=>t.stop());
      };
      mediaRecorder.start();
      status.textContent = 'Recording…';
      recBtn.disabled = true;
      stopBtn.disabled = false;
    }catch(err){
      status.textContent = 'Microphone permission denied or unavailable.';
    }
  });

  stopBtn.addEventListener('click', ()=>{
    if(mediaRecorder && mediaRecorder.state==='recording'){
      mediaRecorder.stop();
      recBtn.disabled = false;
      stopBtn.disabled = true;
    }
  });

  return box;
}

function patternQuest(world){
  const abb = world.patterns?.abb?.length ? world.patterns.abb : ['亮晶晶','笑嘻嘻','绿油油'];
  const target = abb[randInt(0, abb.length-1)];
  const good = target;
  // create distractors by slight edits
  const distractors = makePatternDistractors(target);
  const choices = shuffle([good, ...distractors].slice(0,4));

  const wrap = h('div',{class:'card'},[
    h('h2',{},['Pattern Quest — ABB']),
    h('p',{},['Choose the correct ABB pattern word (A-B-B).']),
    h('div',{class:'question'},[
      h('div',{class:'prompt'},['Pick the correct form:']),
      h('div',{class:'small'},['(Example: 亮晶晶 / 笑嘻嘻)']),
      h('div',{class:'choices'}, choices.map(c=>h('div',{class:'choice', onClick:()=>{
        const ok = c===good;
        toast(ok ? 'Correct!' : 'Not quite.');
        mark(ok, c);
      }},[c])))
    ]),
    h('div',{class:'footerBar', style:'margin-top:10px;'},[
      h('button',{class:'btn', onClick:()=>nav('#/')},['Back']),
      h('button',{class:'btn primary', onClick:()=>{ completeRoom(world.id, currentRoomNo()); nav('#/'); }},['Finish Room'])
    ])
  ]);

  function mark(ok, picked){
    const nodes = wrap.querySelectorAll('.choice');
    nodes.forEach(n=>{
      if(n.textContent===good) n.classList.add('correct');
      if(n.textContent===picked && !ok) n.classList.add('wrong');
    });
  }

  return wrap;
}

function makePatternDistractors(word){
  // try to produce 3 plausible wrong forms
  const chars = [...word];
  if(chars.length<3) return [''];
  const a = chars[0];
  const b = chars[1];
  const c = chars[2];
  const d1 = a + b + a;
  const d2 = a + a + b;
  const d3 = a + c + c;
  return [d1,d2,d3].filter(x=>x!==word);
}

function secretRewardQuest(world){
  const wrap = h('div',{class:'card'},[
    h('h2',{},['Secret Room — Treasure Review']),
    h('p',{},['You found a secret room. Quick review + bigger reward.']),
  ]);
  const q = vocabQuest(world, {mixed:true});
  wrap.appendChild(q);
  // extra reward on completion is handled in completeRoom() via secret bonus
  return wrap;
}

function renderTimeTrial(world, prog){
  const start = performance.now();
  const items = pickDueVocab(STATE, world, 6);
  const questions = [];
  for(let i=0;i<3;i++){
    const target = items[randInt(0, items.length-1)];
    const pool = shuffle(items.slice()).slice(0,4);
    if(!pool.find(x=>x.id===target.id)) pool[0]=target;
    shuffle(pool);
    questions.push({ target, pool });
  }

  let qIndex = 0;
  let correctCount = 0;

  const wrap = h('div',{class:'card'},[
    h('h2',{},['Time Trial — 3 Questions']),
    h('p',{},['Answer quickly. Try to beat your best time.']),
  ]);

  const stage = h('div',{class:'question'},[]);
  wrap.appendChild(stage);

  const footer = h('div',{class:'footerBar', style:'margin-top:10px;'},[
    h('button',{class:'btn', onClick:()=>nav('#/')},['Back']),
    h('button',{class:'btn primary', id:'ttFinish', onClick:()=>{}},['Finish'])
  ]);
  wrap.appendChild(footer);

  function renderQ(){
    stage.innerHTML='';
    const q = questions[qIndex];
    stage.appendChild(h('div',{class:'prompt'},[`(${qIndex+1}/3) Meaning for “${q.target.pinyin}” ?`]))
    const choices = h('div',{class:'choices'}, q.pool.map(c=>h('div',{class:'choice', onClick:()=>{
      const ok = c.id===q.target.id;
      if(ok){
        correctCount += 1;
        toast('Correct');
      }else{
        toast('Wrong');
      }
      scheduleSRS(STATE, q.target.id, ok);
      qIndex += 1;
      if(qIndex<3) renderQ();
      else finish();
    }},[c.meaning])));
    stage.appendChild(choices);
  }

  function finish(){
    const end = performance.now();
    const ms = Math.round(end - start);
    const prev = prog.bestTimeTrialMs;
    const improved = !prev || ms < prev;
    if(improved) prog.bestTimeTrialMs = ms;
    const reward = 10 + correctCount*5 + (improved ? 10 : 0);
    STATE.economy.coins += reward;
    saveState(STATE);

    stage.innerHTML='';
    stage.appendChild(h('div',{class:'prompt'},[`Done! Time: ${(ms/1000).toFixed(2)}s • Correct: ${correctCount}/3`]))
    stage.appendChild(h('div',{class:'small'},[improved ? 'New personal best! Bonus awarded.' : 'Try again tomorrow to beat your best time.']))
    stage.appendChild(h('div',{class:'small', style:'margin-top:6px;'},[`Reward: +${reward} coins`]))
  }

  renderQ();
  return wrap;
}

function renderImport(){
  const world = getActiveWorld(STATE);

  const left = h('div',{class:'card'},[
    h('h2',{},['Lesson Import (Parent Mode)']),
    h('p',{},['Paste the weekly lesson content. This MVP supports two formats: JSON template, or simple text blocks.']),

    h('div',{class:'formRow'},[
      h('div',{},[
        h('label',{},['World title']),
        h('input',{id:'wTitle', value: world.title})
      ]),
      h('div',{},[
        h('label',{},['Week label']),
        h('input',{id:'wLabel', value: world.weekLabel})
      ])
    ]),

    h('hr'),
    h('label',{},['Option A — JSON (recommended)']),
    h('textarea',{id:'jsonBox', placeholder:'Paste JSON here (see template on the right).'}),
    h('div',{style:'display:flex; gap:10px; flex-wrap:wrap; margin-top:10px;'},[
      h('button',{class:'btn primary', onClick:()=>applyJSON()},['Import JSON']),
      h('button',{class:'btn', onClick:()=>{document.getElementById('jsonBox').value = JSON.stringify(jsonTemplate(), null, 2)}},['Insert Template'])
    ]),

    h('hr'),
    h('label',{},['Option B — Quick paste blocks (minimal)']),
    h('p',{class:'small'},['Vocab: one per line as “hanzi | pinyin | meaning”. Text: one per line as “pinyin | hanzi”. (Hanzi optional.)']),
    h('label',{},['Vocab block']),
    h('textarea',{id:'vocabBox', placeholder:'池塘 | chí táng | pond\n蜻蜓 | qīng tíng | dragonfly'}),
    h('label',{},['Text lines block']),
    h('textarea',{id:'textBox', placeholder:'hé yè yuán yuán de | 荷叶圆圆的\nxiǎo shuǐ zhū shuō | 小水珠说'}),
    h('div',{style:'display:flex; gap:10px; flex-wrap:wrap; margin-top:10px;'},[
      h('button',{class:'btn primary', onClick:()=>applyBlocks()},['Import Blocks']),
    ]),

    h('hr'),
    h('button',{class:'btn danger', onClick:()=>resetAll()},['Reset app data (demo)']),
  ]);

  const right = h('div',{class:'card'},[
    h('h2',{},['Template + Tips']),
    h('p',{},['Paste the lesson packet’s sections into the fields. Start pinyin-first for your son; keep Hanzi optional.']),
    h('div',{class:'small'},['JSON fields: title, weekLabel, phonicsFocus, vocab[], textLines[], characters[], patterns.abb[], grammarPoints[].']),
    h('hr'),
    h('pre',{style:'white-space:pre-wrap; font-family:var(--mono); font-size:12px; margin:0;'},[JSON.stringify(jsonTemplate(), null, 2)]),
  ]);

  return h('div',{class:'grid'},[left,right]);

  function applyJSON(){
    const box = document.getElementById('jsonBox');
    const title = document.getElementById('wTitle').value.trim();
    const label = document.getElementById('wLabel').value.trim();
    let obj;
    try{
      obj = JSON.parse(box.value);
    }catch{
      toast('Invalid JSON.');
      return;
    }
    const newWorld = normalizeWorld(obj);
    newWorld.title = title || newWorld.title;
    newWorld.weekLabel = label || newWorld.weekLabel;
    upsertWorld(newWorld);
    toast('Lesson imported.');
    nav('#/');
  }

  function applyBlocks(){
    const title = document.getElementById('wTitle').value.trim() || 'New World';
    const label = document.getElementById('wLabel').value.trim() || 'Week';
    const vocabText = document.getElementById('vocabBox').value;
    const textText = document.getElementById('textBox').value;

    const vocab = parseVocabBlock(vocabText);
    const lines = parseTextBlock(textText);
    if(vocab.length===0 && lines.length===0){
      toast('Nothing to import.');
      return;
    }

    const newWorld = normalizeWorld({
      id: makeId('world'),
      title, weekLabel: label,
      vocab,
      textLines: lines,
      phonicsFocus: ['zh','ch','sh','r']
    });
    upsertWorld(newWorld);
    toast('Blocks imported.');
    nav('#/');
  }

  function resetAll(){
    if(!confirm('Reset all local app data?')) return;
    localStorage.removeItem(LS_KEY);
    STATE = loadState();
    render();
    toast('Reset complete.');
  }
}

function parseVocabBlock(txt){
  const out=[];
  txt.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).forEach(line=>{
    const parts = line.split('|').map(s=>s.trim());
    if(parts.length>=2){
      out.push({ id: makeId('v'), hanzi: parts[0]||'', pinyin: parts[1]||'', meaning: parts[2]||'' });
    }
  });
  return out;
}

function parseTextBlock(txt){
  const out=[];
  txt.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).forEach(line=>{
    const parts = line.split('|').map(s=>s.trim());
    if(parts.length>=1){
      out.push({ pinyin: parts[0]||'', hanzi: parts[1]||'' });
    }
  });
  return out;
}

function normalizeWorld(obj){
  const w = {
    id: obj.id || makeId('world'),
    title: obj.title || 'World',
    weekLabel: obj.weekLabel || 'Week',
    phonicsFocus: Array.isArray(obj.phonicsFocus) ? obj.phonicsFocus : [],
    vocab: Array.isArray(obj.vocab) ? obj.vocab.map(v=>({id: v.id||makeId('v'), hanzi:v.hanzi||'', pinyin:v.pinyin||'', meaning:v.meaning||''})) : [],
    characters: Array.isArray(obj.characters) ? obj.characters.map(c=>({hanzi:c.hanzi||'', pinyin:c.pinyin||''})) : [],
    patterns: obj.patterns && typeof obj.patterns==='object' ? { abb: Array.isArray(obj.patterns.abb)? obj.patterns.abb : [] } : { abb: [] },
    grammarPoints: Array.isArray(obj.grammarPoints) ? obj.grammarPoints.map(g=>({type:g.type||'note', example:g.example||'', note:g.note||''})) : [],
    textLines: Array.isArray(obj.textLines) ? obj.textLines.map(l=>({hanzi:l.hanzi||'', pinyin:l.pinyin||''})) : [],
  };
  return w;
}

function upsertWorld(world){
  const idx = STATE.worlds.findIndex(w=>w.id===world.id);
  if(idx>=0) STATE.worlds[idx]=world; else STATE.worlds.push(world);
  STATE.activeWorldId = world.id;
  ensureWorldProgress(STATE, world.id);
  saveState(STATE);
}

function jsonTemplate(){
  return {
    title: 'World 2 — Haunted School',
    weekLabel: 'Week 2',
    phonicsFocus: ['zh','ch','sh','r'],
    vocab: [
      { hanzi:'池塘', pinyin:'chí táng', meaning:'pond' },
      { hanzi:'蜻蜓', pinyin:'qīng tíng', meaning:'dragonfly' }
    ],
    textLines: [
      { pinyin:'hé yè yuán yuán de', hanzi:'荷叶圆圆的' },
      { pinyin:'xiǎo shuǐ zhū shuō', hanzi:'小水珠说' }
    ],
    characters: [
      { hanzi:'池', pinyin:'chí' },
      { hanzi:'塘', pinyin:'táng' }
    ],
    patterns: { abb: ['亮晶晶','笑嘻嘻','绿油油'] },
    grammarPoints: [
      { type:'simile', example:'荷叶像我的摇篮。', note:'Simile pattern: 像…一样 / 像…' }
    ]
  };
}

function renderStats(){
  const world = getActiveWorld(STATE);
  const prog = ensureWorldProgress(STATE, world.id);
  const completed = Object.keys(prog.completedRooms).length;

  const dueCount = pickDueVocab(STATE, world, 999).length;

  const list = world.vocab.slice(0,20).map(v=>{
    const e = STATE.srs[v.id];
    return h('div',{class:'question'},[
      h('div',{class:'prompt'},[`${v.pinyin} ${STATE.settings.showHanzi? '• '+v.hanzi : ''}`]),
      h('div',{class:'small'},[`Meaning: ${v.meaning || '—'} • Due: ${e? e.due : 'today'} • Interval: ${e? e.interval+'d' : '—'}`])
    ]);
  });

  return h('div',{class:'grid'},[
    h('div',{class:'card'},[
      h('h2',{},['Progress']),
      h('div',{class:'kpiRow'},[
        h('div',{class:'kpi'},[h('div',{class:'label'},['Rooms completed']), h('div',{class:'big'},[String(completed)])]),
        h('div',{class:'kpi'},[h('div',{class:'label'},['Unlocked room']), h('div',{class:'big'},[String(prog.unlockedRoom)])]),
        h('div',{class:'kpi'},[h('div',{class:'label'},['Due vocab (approx)']), h('div',{class:'big'},[String(dueCount)])]),
      ]),
      h('hr'),
      h('h2',{},['Vocab (first 20)']),
      ...list
    ]),
    h('div',{class:'card'},[
      h('h2',{},['Worlds']),
      h('p',{},['Each imported week is a separate world with its own door chain.']),
      ...STATE.worlds.map(w=>{
        const active = w.id===STATE.activeWorldId;
        return h('div',{class:'question'},[
          h('div',{class:'prompt'},[w.title + (active ? ' (active)' : '')]),
          h('div',{class:'small'},[`${w.weekLabel} • Vocab: ${w.vocab.length} • Lines: ${w.textLines.length}`]),
          h('div',{style:'margin-top:8px; display:flex; gap:10px; flex-wrap:wrap;'},[
            h('button',{class:'btn', onClick:()=>{
              STATE.activeWorldId = w.id;
              ensureWorldProgress(STATE, w.id);
              saveState(STATE);
              toast('Active world changed.');
              render();
            }},['Set active']),
            h('button',{class:'btn danger', onClick:()=>{
              if(!confirm('Delete this world?')) return;
              STATE.worlds = STATE.worlds.filter(x=>x.id!==w.id);
              if(STATE.worlds.length===0) STATE.worlds=[makeDemoLesson()];
              STATE.activeWorldId = STATE.worlds[0].id;
              saveState(STATE);
              render();
            }},['Delete'])
          ])
        ])
      })
    ])
  ]);
}

function renderSettings(){
  const s = STATE.settings;
  const wrap = h('div',{class:'grid'},[
    h('div',{class:'card'},[
      h('h2',{},['Settings']),
      h('p',{},['Keep it pinyin-first, and only show Hanzi when he wants extra challenge.']),
      h('label',{},['Scare level (ambience only)']),
      h('select',{id:'scareSel'},[
        h('option',{value:'low'},['Low']),
        h('option',{value:'medium'},['Medium'])
      ]),
      h('div',{style:'margin-top:10px;'},[
        h('label',{},['Show Hanzi by default']),
        h('select',{id:'hanziSel'},[
          h('option',{value:'no'},['No (pinyin-first)']),
          h('option',{value:'yes'},['Yes'])
        ])
      ]),
      h('div',{style:'display:flex; gap:10px; flex-wrap:wrap; margin-top:12px;'},[
        h('button',{class:'btn primary', onClick:()=>saveSettings()},['Save settings']),
        h('button',{class:'btn', onClick:()=>nav('#/')},['Back'])
      ]),
    ]),
    h('div',{class:'card'},[
      h('h2',{},['Notes']),
      h('p',{},['This version runs entirely in the browser and stores progress locally. If you want sync across PCs later, we can add a simple login and a small backend (Supabase/Firebase).']),
      h('hr'),
      h('p',{},['For a stronger horror tone, you can later add: ambient background audio, animated door opening, and “monster” mascots that appear only as gentle visual stickers.'])
    ])
  ]);

  // set initial
  setTimeout(()=>{
    const scareSel = wrap.querySelector('#scareSel');
    const hanziSel = wrap.querySelector('#hanziSel');
    scareSel.value = s.scareLevel;
    hanziSel.value = s.showHanzi ? 'yes' : 'no';
  },0);

  function saveSettings(){
    const scareSel = wrap.querySelector('#scareSel').value;
    const hanziSel = wrap.querySelector('#hanziSel').value;
    STATE.settings.scareLevel = scareSel;
    STATE.settings.showHanzi = (hanziSel==='yes');

    // ambience intensity tweak: adjust fog opacity
    if(scareSel==='medium') document.body.style.setProperty('--fogOpacity', '.75');
    saveState(STATE);
    toast('Saved.');
    render();
  }

  return wrap;
}

// ------- Helpers -------

function shuffle(arr){
  for(let i=arr.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]]=[arr[j],arr[i]];
  }
  return arr;
}

function currentRoomNo(){
  const route = (location.hash || '#/').slice(2);
  if(route.startsWith('room/')) return parseInt(route.split('/')[1],10);
  return 1;
}

// initial
render();
