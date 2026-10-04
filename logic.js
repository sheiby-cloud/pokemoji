// だれモジ 判定ロジック(UIに依存しない純粋関数)
// ブラウザでは window.DaremojiLogic、Node.js では require('./logic.js') で使う。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DaremojiLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const GREEN = 'green';
  const YELLOW = 'yellow';
  const GRAY = 'gray';

  // 入力と名前リストを同じ手順で正規化する(仕様4章)
  function normalize(str) {
    return String(str)
      .normalize('NFKC')
      .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
      .trim();
  }

  // コードポイント単位で1文字ずつに分割する
  function chars(str) {
    return Array.from(str);
  }

  // 正解と入力を比べ、各文字の色を返す(仕様5章・重複文字は本家と同じ扱い)
  function judge(answer, guess) {
    const a = chars(answer);
    const g = chars(guess);
    if (a.length !== g.length) throw new Error('文字数が違います');

    const remain = new Map();
    for (const c of a) remain.set(c, (remain.get(c) || 0) + 1);

    const result = new Array(g.length).fill(GRAY);
    for (let i = 0; i < g.length; i++) {
      if (g[i] === a[i]) {
        result[i] = GREEN;
        remain.set(g[i], remain.get(g[i]) - 1);
      }
    }
    for (let i = 0; i < g.length; i++) {
      if (result[i] === GREEN) continue;
      const n = remain.get(g[i]) || 0;
      if (n > 0) {
        result[i] = YELLOW;
        remain.set(g[i], n - 1);
      }
    }
    return result;
  }

  // 入力のチェック。問題なければ null、だめならメッセージを返す
  function validate(guess, answer, nameSet) {
    const len = chars(answer).length;
    if (chars(guess).length !== len) return `${len}文字の名前を入力してください`;
    if (!nameSet.has(guess)) return '図鑑にない名前です';
    return null;
  }

  // Fisher–Yates シャッフル
  function shuffle(arr, rand = Math.random) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // 使った文字ごとに最も良い色を求める(緑 > 黄 > 灰)
  const RANK = { [GRAY]: 1, [YELLOW]: 2, [GREEN]: 3 };
  function letterStates(rows) {
    const map = new Map();
    for (const { guess, result } of rows) {
      chars(guess).forEach((c, i) => {
        const cur = map.get(c);
        if (!cur || RANK[result[i]] > RANK[cur]) map.set(c, result[i]);
      });
    }
    return map;
  }

  const EMOJI = { [GREEN]: '🟩', [YELLOW]: '🟨', [GRAY]: '⬜' };
  const EMOJI_HC = { [GREEN]: '🟧', [YELLOW]: '🟦', [GRAY]: '⬜' };
  function shareText({ gen, length, rows, won, maxTries, highContrast }) {
    const e = highContrast ? EMOJI_HC : EMOJI;
    const score = won ? rows.length : 'X';
    const head = `だれモジ 第${gen}世代まで ${length}文字 ${score}/${maxTries}`;
    return [head, ...rows.map((r) => r.result.map((x) => e[x]).join(''))].join('\n');
  }

  return { GREEN, YELLOW, GRAY, normalize, chars, judge, validate, shuffle, letterStates, shareText };
});
