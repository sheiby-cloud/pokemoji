// だれモジ ゲーム進行・入力・保存
(function () {
  'use strict';

  const L = window.DaremojiLogic;
  const MAX_SUGGEST = 5;
  const FLIP_MS = 220;
  const MAX_TRIES_LIMIT = 12; // 成績の分布を何回目まで持つか(回数設定の上限と合わせる)
  const KEY = {
    settings: 'daremoji.settings',
    queue: 'daremoji.queue',
    game: 'daremoji.game',
    stats: 'daremoji.stats',
  };

  const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

  // ---- 設定の定義 ----
  // 設定項目を追加・変更するときはこの配列だけを書き換える。設定画面・保存・初期値はここから作られる。
  //   key      : 保存名(settings[key] で参照)
  //   group    : 設定画面の見出し
  //   type     : 'choice'(ボタンから1つ選ぶ) / 'toggle'(オン・オフ)
  //   options  : choice の選択肢
  //   default  : 初期値
  //   perGame  : true なら問題の開始時に値を固定し、途中で変えても次の問題から適用する
  //   label / note / optionLabel / optionAria : 表示文言(関数なら現在値などを受け取る)
  //   onChange : 値が変わったときに呼ぶ処理
  const SETTINGS = [
    {
      key: 'maxGen',
      group: '難易度',
      label: '出題範囲',
      type: 'choice',
      options: range(1, 9),
      default: 9,
      perGame: true,
      optionAria: (v) => `第${v}世代まで`,
      note: (v) => `第${v}世代まで(${candidates(v).length}匹から出題)。範囲が狭いほど易しくなります`,
      onChange: () => {
        // 新しい範囲で出題順をシャッフルし直す
        reshuffle(game && game.answer);
        save(KEY.queue, queue);
      },
    },
    {
      key: 'maxTries',
      group: '難易度',
      label: '回答できる回数',
      type: 'choice',
      options: range(5, MAX_TRIES_LIMIT),
      default: 6,
      perGame: true,
      optionAria: (v) => `${v}回まで`,
      note: (v) => `${v}回まで回答できます`,
    },
    {
      key: 'suggest',
      group: '難易度',
      label: '入力候補を表示する',
      type: 'toggle',
      default: true,
      note: () => '入力中に、同じ文字数で一致する名前を最大5件表示します',
      onChange: () => renderSuggest(),
    },
    {
      key: 'highContrast',
      group: '見た目',
      label: '高コントラスト配色',
      type: 'toggle',
      default: false,
      note: () => '緑をオレンジ、黄を青で表示します',
      onChange: () => applyTheme(),
    },
  ];

  function isValidSetting(def, v) {
    return def.type === 'toggle' ? typeof v === 'boolean' : def.options.includes(v);
  }

  // ---- 保存(保存できない環境でも遊べるよう try/catch) ----
  function load(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* 保存できなくても続行 */ }
  }

  // ---- 状態 ----
  let names = [];          // [{no, name, gen}]
  let nameSet = new Set(); // 入力として受け付ける全世代の名前
  const settings = (() => {
    const saved = load(KEY.settings, {}) || {};
    const s = {};
    for (const def of SETTINGS) s[def.key] = isValidSetting(def, saved[def.key]) ? saved[def.key] : def.default;
    return s;
  })();
  let queue = load(KEY.queue, null); // { maxGen, order: [name], pos }
  let game = load(KEY.game, null);   // { answer, rows: [{guess, result}], done, won, ...perGame の設定値 }
  let stats = Object.assign({ played: 0, wins: 0, streak: 0, maxStreak: 0, dist: [] }, load(KEY.stats, {}));
  while (stats.dist.length < MAX_TRIES_LIMIT) stats.dist.push(0);
  let busy = false;

  const $ = (id) => document.getElementById(id);
  const el = {
    notice: $('notice'), board: $('board'), entry: $('entry'), guess: $('guess'),
    submit: $('submit'), suggest: $('suggest'), used: $('used'), toast: $('toast'),
    nextInline: $('next-inline'),
    dlgHelp: $('dlg-help'), dlgStats: $('dlg-stats'), dlgSettings: $('dlg-settings'),
    settingsBody: $('settings-body'), settingsNote: $('settings-note'),
  };

  // ---- 出題 ----
  function candidates(maxGen) {
    return names.filter((n) => n.gen <= maxGen).map((n) => n.name);
  }

  function reshuffle(avoid) {
    const order = L.shuffle(candidates(settings.maxGen));
    // 一巡した直後に直前と同じ問題が続かないようにする
    if (avoid && order.length > 1 && order[0] === avoid) {
      [order[0], order[order.length - 1]] = [order[order.length - 1], order[0]];
    }
    queue = { maxGen: settings.maxGen, order, pos: 0 };
  }

  function nextAnswer() {
    const valid = queue && queue.maxGen === settings.maxGen && Array.isArray(queue.order) &&
      queue.order.length > 0 && queue.order.every((n) => nameSet.has(n));
    if (!valid || queue.pos >= queue.order.length) reshuffle(game && game.answer);
    const answer = queue.order[queue.pos++];
    save(KEY.queue, queue);
    return answer;
  }

  function newGame() {
    const answer = nextAnswer();
    game = { answer, rows: [], done: false, won: false };
    for (const def of SETTINGS) if (def.perGame) game[def.key] = settings[def.key];
    save(KEY.game, game);
    el.guess.value = '';
    renderAll();
    if (!matchMedia('(hover: none)').matches) el.guess.focus();
  }

  // ---- 描画 ----
  function answerLen() {
    return L.chars(game.answer).length;
  }

  function renderNotice() {
    el.notice.textContent = `第${game.maxGen}世代まで・${answerLen()}文字のポケモン・${game.maxTries}回まで`;
    $('help-tries').textContent = `${game.maxTries}回以内`;
  }

  function renderBoard(animateRow = -1) {
    const len = answerLen();
    el.board.innerHTML = '';
    el.board.style.setProperty('--rows', game.maxTries);
    el.board.classList.toggle('compact', game.maxTries >= 9);
    for (let r = 0; r < game.maxTries; r++) {
      const row = document.createElement('div');
      row.className = 'row';
      row.setAttribute('role', 'row');
      const data = game.rows[r];
      const letters = data ? L.chars(data.guess) : [];
      for (let i = 0; i < len; i++) {
        const t = document.createElement('div');
        t.className = 'tile';
        t.setAttribute('role', 'gridcell');
        if (data) {
          t.textContent = letters[i];
          t.dataset.state = data.result[i];
          t.setAttribute('aria-label', `${letters[i]} ${stateLabel(data.result[i])}`);
          if (r === animateRow) {
            t.classList.add('flip');
            t.style.setProperty('--i', i);
          }
        }
        row.appendChild(t);
      }
      el.board.appendChild(row);
    }
    renderTyping();
  }

  // 入力中の文字を現在の行にプレビュー表示
  function renderTyping() {
    if (game.done || game.rows.length >= game.maxTries) return;
    const row = el.board.children[game.rows.length];
    if (!row) return;
    const letters = L.chars(L.normalize(el.guess.value));
    Array.from(row.children).forEach((t, i) => {
      t.textContent = letters[i] || '';
      t.classList.toggle('filled', !!letters[i]);
    });
  }

  function stateLabel(s) {
    return s === L.GREEN ? '位置も一致' : s === L.YELLOW ? '位置が違う' : '含まれない';
  }

  function renderUsed() {
    const map = L.letterStates(game.rows);
    el.used.innerHTML = '';
    for (const [c, s] of map) {
      const t = document.createElement('span');
      t.className = 'tile';
      t.dataset.state = s;
      t.textContent = c;
      t.setAttribute('aria-label', `${c} ${stateLabel(s)}`);
      el.used.appendChild(t);
    }
  }

  function renderSuggest() {
    el.suggest.innerHTML = '';
    el.suggest.hidden = !settings.suggest;
    if (!settings.suggest || !game || game.done) return;
    const q = L.normalize(el.guess.value);
    if (!q) return;
    const len = answerLen();
    const pool = names.filter((n) => n.gen <= settings.maxGen && L.chars(n.name).length === len);
    const starts = pool.filter((n) => n.name.startsWith(q));
    const contains = pool.filter((n) => !n.name.startsWith(q) && n.name.includes(q));
    const hits = starts.concat(contains).slice(0, MAX_SUGGEST);
    if (hits.length === 1 && hits[0].name === q) return;
    for (const n of hits) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = n.name;
      b.addEventListener('click', () => {
        el.guess.value = n.name;
        renderTyping();
        renderSuggest();
        el.guess.focus();
      });
      li.appendChild(b);
      el.suggest.appendChild(li);
    }
  }

  function renderControls() {
    el.guess.disabled = game.done;
    el.submit.disabled = game.done;
    el.entry.querySelector('.entry-row').hidden = game.done;
    el.nextInline.hidden = !game.done;
  }

  function renderAll() {
    renderNotice();
    renderBoard();
    renderUsed();
    renderSuggest();
    renderControls();
  }

  // ---- 入力 ----
  let toastTimer = 0;
  function toast(msg, ms = 1800) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), ms);
  }

  function shake() {
    const row = el.board.children[game.rows.length];
    if (!row) return;
    row.classList.remove('shake');
    void row.offsetWidth;
    row.classList.add('shake');
  }

  function praise(tries, max) {
    if (tries === 1) return 'おみごと!';
    if (tries === max) return 'ぎりぎり!';
    const words = ['すごい!', 'やったね!', 'いいね!', 'なるほど!'];
    return words[Math.min(words.length - 1, Math.floor(((tries - 2) / Math.max(1, max - 2)) * words.length))];
  }

  function submit() {
    if (busy || game.done) return;
    const guess = L.normalize(el.guess.value);
    if (!guess) return;
    const err = L.validate(guess, game.answer, nameSet);
    if (err) {
      toast(err);
      shake();
      return;
    }
    const result = L.judge(game.answer, guess);
    game.rows.push({ guess, result });
    const won = result.every((r) => r === L.GREEN);
    if (won || game.rows.length >= game.maxTries) {
      game.done = true;
      game.won = won;
      recordStats(won, game.rows.length);
    }
    save(KEY.game, game);

    el.guess.value = '';
    el.suggest.innerHTML = '';
    busy = true;
    renderBoard(game.rows.length - 1);
    const wait = FLIP_MS * (answerLen() - 1) + 500;
    setTimeout(() => {
      busy = false;
      renderUsed();
      renderControls();
      if (game.done) {
        toast(won ? praise(game.rows.length, game.maxTries) : `正解は「${game.answer}」`, 1500);
        setTimeout(() => openStats(), 900);
      }
    }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : wait);
  }

  // ---- 成績 ----
  function recordStats(won, tries) {
    stats.played++;
    if (won) {
      stats.wins++;
      stats.streak++;
      stats.maxStreak = Math.max(stats.maxStreak, stats.streak);
      stats.dist[tries - 1]++;
    } else {
      stats.streak = 0;
    }
    save(KEY.stats, stats);
  }

  function openStats() {
    $('st-played').textContent = stats.played;
    $('st-rate').textContent = stats.played ? Math.round((stats.wins / stats.played) * 100) : 0;
    $('st-streak').textContent = stats.streak;
    $('st-max').textContent = stats.maxStreak;

    // 分布は「今の回数設定」と「これまでに当てた最大の回数」の大きいほうまで表示
    const lastHit = stats.dist.reduce((m, n, i) => (n > 0 ? i + 1 : m), 0);
    const shown = Math.max(game ? game.maxTries : settings.maxTries, lastHit);
    const dist = $('dist');
    dist.innerHTML = '';
    const max = Math.max(1, ...stats.dist);
    stats.dist.slice(0, shown).forEach((n, i) => {
      const row = document.createElement('div');
      row.className = 'dist-row';
      const label = document.createElement('span');
      label.textContent = i + 1;
      const bar = document.createElement('span');
      bar.className = 'dist-bar';
      if (game && game.done && game.won && game.rows.length === i + 1) bar.classList.add('hit');
      bar.style.width = `${Math.max(8, (n / max) * 100)}%`;
      bar.textContent = n;
      row.append(label, bar);
      dist.appendChild(row);
    });

    const finished = game && game.done;
    $('result').hidden = !finished;
    $('result-actions').hidden = !finished;
    if (finished) {
      $('result-msg').textContent = game.won ? `${game.rows.length}回目で正解!` : '残念…';
      $('result-answer').textContent = game.answer;
      $('stats-title').textContent = '結果';
    } else {
      $('stats-title').textContent = '成績';
    }
    openDialog(el.dlgStats);
  }

  async function share() {
    const text = L.shareText({
      gen: game.maxGen,
      length: answerLen(),
      rows: game.rows,
      won: game.won,
      maxTries: game.maxTries,
      highContrast: settings.highContrast,
    });
    try {
      await navigator.clipboard.writeText(text);
      toast('結果をコピーしました');
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand && document.execCommand('copy');
      ta.remove();
      toast(ok ? '結果をコピーしました' : 'コピーできませんでした');
    }
  }

  // ---- 設定 ----
  function applyTheme() {
    document.documentElement.classList.toggle('hc', !!settings.highContrast);
  }

  const text = (v, ...args) => (typeof v === 'function' ? v(...args) : v || '');

  function renderSettings() {
    const body = el.settingsBody;
    body.innerHTML = '';
    let group = null;
    for (const def of SETTINGS) {
      if (def.group !== group) {
        group = def.group;
        const h = document.createElement('h3');
        h.textContent = group;
        body.appendChild(h);
      }
      const value = settings[def.key];
      const item = document.createElement('div');
      item.className = 'setting';

      if (def.type === 'toggle') {
        const row = document.createElement('label');
        row.className = 'switch-row';
        const span = document.createElement('span');
        span.textContent = def.label;
        const note = text(def.note, value);
        if (note) {
          const n = document.createElement('span');
          n.className = 'small muted setting-note';
          n.textContent = note;
          span.appendChild(n);
        }
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.setAttribute('role', 'switch');
        input.checked = value;
        input.addEventListener('change', () => setSetting(def, input.checked));
        row.append(span, input);
        item.appendChild(row);
      } else {
        const label = document.createElement('div');
        label.className = 'setting-label';
        label.textContent = def.label;
        const note = document.createElement('p');
        note.className = 'small setting-note';
        note.textContent = text(def.note, value);
        const opts = document.createElement('div');
        opts.className = 'choices';
        opts.setAttribute('role', 'radiogroup');
        opts.setAttribute('aria-label', def.label);
        opts.style.setProperty('--n', def.options.length);
        for (const o of def.options) {
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = text(def.optionLabel, o) || String(o);
          b.setAttribute('role', 'radio');
          b.setAttribute('aria-checked', String(o === value));
          if (def.optionAria) b.setAttribute('aria-label', def.optionAria(o));
          b.addEventListener('click', () => setSetting(def, o));
          opts.appendChild(b);
        }
        item.append(label, opts, note);
      }
      body.appendChild(item);
    }
    const pending = game && !game.done && game.rows.length > 0 &&
      SETTINGS.some((d) => d.perGame && game[d.key] !== settings[d.key]);
    el.settingsNote.hidden = !pending;
  }

  function setSetting(def, value) {
    if (settings[def.key] === value || !isValidSetting(def, value)) return;
    settings[def.key] = value;
    save(KEY.settings, settings);
    if (def.onChange) def.onChange(value);
    if (def.perGame && game && !game.done && game.rows.length === 0) {
      // まだ1回も入力していない問題なら、新しい設定ですぐ出し直す
      newGame();
    }
    renderSettings();
  }

  function openDialog(d) {
    for (const x of [el.dlgHelp, el.dlgStats, el.dlgSettings]) if (x !== d && x.open) x.close();
    if (!d.open) d.showModal();
  }

  // ---- イベント ----
  function bind() {
    el.entry.addEventListener('submit', (e) => {
      e.preventDefault();
      submit();
    });
    el.guess.addEventListener('input', () => {
      renderTyping();
      renderSuggest();
    });
    $('btn-help').addEventListener('click', () => openDialog(el.dlgHelp));
    $('btn-stats').addEventListener('click', openStats);
    $('btn-settings').addEventListener('click', () => {
      renderSettings();
      openDialog(el.dlgSettings);
    });
    $('btn-share').addEventListener('click', share);
    const next = () => {
      if (el.dlgStats.open) el.dlgStats.close();
      newGame();
    };
    $('btn-next').addEventListener('click', next);
    el.nextInline.addEventListener('click', next);
    document.querySelectorAll('[data-close]').forEach((b) =>
      b.addEventListener('click', () => b.closest('dialog').close())
    );
    // 背景クリックで閉じる
    for (const d of [el.dlgHelp, el.dlgStats, el.dlgSettings]) {
      d.addEventListener('click', (e) => {
        if (e.target === d) d.close();
      });
    }
  }

  // ---- 起動 ----
  async function init() {
    applyTheme();
    bind();
    try {
      const res = await fetch('names.json');
      names = await res.json();
    } catch (e) {
      el.notice.textContent = '名前リストを読み込めませんでした。再読み込みしてください。';
      return;
    }
    nameSet = new Set(names.map((n) => L.normalize(n.name)));

    const resumable = game && typeof game.answer === 'string' && nameSet.has(game.answer) && Array.isArray(game.rows);
    if (resumable) {
      // 旧版で保存した問題(gen のみ・回数は6回固定)も再開できるようにする
      if (game.maxGen === undefined && Number.isInteger(game.gen)) game.maxGen = game.gen;
      if (game.maxTries === undefined) game.maxTries = 6;
      for (const def of SETTINGS) {
        if (def.perGame && !isValidSetting(def, game[def.key])) game[def.key] = settings[def.key];
      }
      save(KEY.game, game);
      renderAll();
    } else {
      newGame();
    }
    let seenHelp = false;
    try { seenHelp = localStorage.getItem('daremoji.seenHelp') === '1'; } catch (e) { /* noop */ }
    if (!seenHelp && stats.played === 0 && (!game || game.rows.length === 0)) {
      openDialog(el.dlgHelp);
      try { localStorage.setItem('daremoji.seenHelp', '1'); } catch (e) { /* noop */ }
    }
  }

  init();
})();
