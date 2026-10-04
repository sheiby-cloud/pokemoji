// だれモジ ゲーム進行・入力・保存
(function () {
  'use strict';

  const L = window.DaremojiLogic;
  const MAX_TRIES = 6;
  const MAX_SUGGEST = 5;
  const FLIP_MS = 220;
  const KEY = {
    settings: 'daremoji.settings',
    queue: 'daremoji.queue',
    game: 'daremoji.game',
    stats: 'daremoji.stats',
  };

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
  let settings = Object.assign({ maxGen: 9, highContrast: false }, load(KEY.settings, {}));
  let queue = load(KEY.queue, null); // { maxGen, order: [name], pos }
  let game = load(KEY.game, null);   // { answer, gen, rows: [{guess, result}], done, won }
  let stats = Object.assign(
    { played: 0, wins: 0, streak: 0, maxStreak: 0, dist: [0, 0, 0, 0, 0, 0] },
    load(KEY.stats, {})
  );
  let busy = false;

  const $ = (id) => document.getElementById(id);
  const el = {
    notice: $('notice'), board: $('board'), entry: $('entry'), guess: $('guess'),
    submit: $('submit'), suggest: $('suggest'), used: $('used'), toast: $('toast'),
    nextInline: $('next-inline'),
    dlgHelp: $('dlg-help'), dlgStats: $('dlg-stats'), dlgSettings: $('dlg-settings'),
    gens: $('gens'), genLabel: $('gen-label'), genNote: $('gen-note'), hc: $('hc'),
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
    if (!valid) reshuffle(game && game.answer);
    else if (queue.pos >= queue.order.length) reshuffle(game && game.answer);
    const answer = queue.order[queue.pos++];
    save(KEY.queue, queue);
    return answer;
  }

  function newGame() {
    const answer = nextAnswer();
    game = { answer, gen: settings.maxGen, rows: [], done: false, won: false };
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
    el.notice.textContent = `第${game.gen}世代まで・${answerLen()}文字のポケモン`;
  }

  function renderBoard(animateRow = -1) {
    const len = answerLen();
    el.board.innerHTML = '';
    for (let r = 0; r < MAX_TRIES; r++) {
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
    if (game.done || game.rows.length >= MAX_TRIES) return;
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
    if (game.done) return;
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
    if (won || game.rows.length >= MAX_TRIES) {
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
        toast(won ? ['おみごと!', 'すごい!', 'やったね!', 'いいね!', 'なるほど!', 'ぎりぎり!'][game.rows.length - 1] : `正解は「${game.answer}」`, 1500);
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

    const dist = $('dist');
    dist.innerHTML = '';
    const max = Math.max(1, ...stats.dist);
    stats.dist.forEach((n, i) => {
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
      gen: game.gen,
      length: answerLen(),
      rows: game.rows,
      won: game.won,
      maxTries: MAX_TRIES,
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

  function renderSettings() {
    el.gens.innerHTML = '';
    for (let g = 1; g <= 9; g++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = g;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(g === settings.maxGen));
      b.setAttribute('aria-label', `第${g}世代まで`);
      b.addEventListener('click', () => setMaxGen(g));
      el.gens.appendChild(b);
    }
    const count = candidates(settings.maxGen).length;
    el.genLabel.textContent = `第${settings.maxGen}世代まで(${count}匹から出題)`;
    el.genNote.hidden = !(game && !game.done && game.rows.length > 0 && game.gen !== settings.maxGen);
    el.hc.checked = !!settings.highContrast;
  }

  function setMaxGen(g) {
    if (g === settings.maxGen) return;
    settings.maxGen = g;
    save(KEY.settings, settings);
    // 新しい範囲で出題順をシャッフルし直す(今の問題はそのまま)
    reshuffle(game && game.answer);
    save(KEY.queue, queue);
    renderSettings();
    renderSuggest();
    // まだ1回も入力していない問題なら、すぐ新しい範囲で出し直す
    if (game && !game.done && game.rows.length === 0) newGame();
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
    el.hc.addEventListener('change', () => {
      settings.highContrast = el.hc.checked;
      save(KEY.settings, settings);
      applyTheme();
    });
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
    if (!(settings.maxGen >= 1 && settings.maxGen <= 9)) settings.maxGen = 9;

    const resumable = game && typeof game.answer === 'string' && nameSet.has(game.answer) &&
      Array.isArray(game.rows) && Number.isInteger(game.gen);
    if (resumable) {
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
