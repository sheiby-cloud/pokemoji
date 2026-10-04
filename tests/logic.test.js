'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../logic.js');
const names = require('../names.json');

const G = L.GREEN, Y = L.YELLOW, X = L.GRAY;

test('仕様5章のテストケース', () => {
  assert.deepEqual(L.judge('ライチュウ', 'ピカチュウ'), [X, X, G, G, G]);
  assert.deepEqual(L.judge('ガラガラ', 'カラカラ'), [X, G, X, G]);
  assert.deepEqual(L.judge('ガラガラ', 'ラプラス'), [Y, X, Y, X]);
  assert.deepEqual(L.judge('カイロス', 'イーブイ'), [Y, X, X, X]);
});

test('緑が黄より優先される', () => {
  // 正解に「イ」は1個。2文字目の位置一致が緑になり、1文字目の「イ」は灰
  assert.deepEqual(L.judge('ライチュウ', 'イイイイイ'), [X, G, X, X, X]);
});

test('正規化: ひらがな・全角・半角カタカナ・空白', () => {
  assert.equal(L.normalize('ぴかちゅう'), 'ピカチュウ');
  assert.equal(L.normalize('  ピカチュウ　'), 'ピカチュウ');
  assert.equal(L.normalize('ﾋﾟｶﾁｭｳ'), 'ピカチュウ');
  assert.equal(L.normalize('ぽりごん２'), 'ポリゴン2');
  assert.equal(L.normalize('ポリゴンＺ'), 'ポリゴンZ');
  assert.equal(L.normalize('にどらん♀'), 'ニドラン♀');
  assert.equal(L.normalize('いーぶい'), 'イーブイ');
});

test('文字の数え方', () => {
  assert.equal(L.chars('ピカチュウ').length, 5);
  assert.equal(L.chars('イーブイ').length, 4);
  assert.equal(L.chars('ニドラン♂').length, 5);
  assert.equal(L.chars(L.normalize('ｶﾞﾗｶﾞﾗ')).length, 4);
});

test('短い名前の判定(左詰め)', () => {
  assert.deepEqual(L.judge('ピカチュウ', 'ピチュー'), [G, Y, Y, X]);
  assert.deepEqual(L.judge('ポリゴンZ', 'ポリゴン'), [G, G, G, G]);
  assert.equal(L.isCorrect('ポリゴンZ', 'ポリゴン'), false); // 全部緑でも正解ではない
  assert.equal(L.isCorrect('ピカチュウ', 'ピカチュウ'), true);
  assert.throws(() => L.judge('イーブイ', 'ピカチュウ'));
});

test('入力チェック(短い名前を許可)', () => {
  const set = new Set(names.map((n) => n.name));
  const opt = { allowShorter: true };
  assert.equal(L.validate('イーブイ', 'ライチュウ', set, opt), null);
  assert.equal(L.validate('ピッピ', 'ライチュウ', set, opt), null);
  assert.equal(L.validate('ピカチュウ', 'イーブイ', set, opt), '4文字以下の名前を入力してください');
  assert.equal(L.validate('ピカピ', 'ライチュウ', set, opt), '図鑑にない名前です');
});

test('入力チェック', () => {
  const set = new Set(names.map((n) => n.name));
  assert.equal(L.validate('ピカチュウ', 'ライチュウ', set), null);
  assert.equal(L.validate('ピカピカピ', 'ライチュウ', set), '図鑑にない名前です');
  assert.equal(L.validate('イーブイ', 'ライチュウ', set), '5文字の名前を入力してください');
  assert.equal(L.validate('マフォクシー', 'ライチュウ', set), '5文字の名前を入力してください');
});

test('names.json の形式', () => {
  assert.ok(names.length > 900);
  const seen = new Set();
  for (const n of names) {
    assert.ok(Number.isInteger(n.no) && n.gen >= 1 && n.gen <= 9, JSON.stringify(n));
    assert.ok(L.chars(n.name).length <= 5, n.name);
    assert.equal(L.normalize(n.name), n.name);
    assert.ok(!seen.has(n.name), '重複: ' + n.name);
    seen.add(n.name);
  }
  for (const s of ['ニドラン♀', 'ニドラン♂', 'ポリゴン2', 'ポリゴンZ', 'ピカチュウ']) assert.ok(seen.has(s), s);
  for (const s of ['タイプ:ヌル', 'カプ・コケコ']) assert.ok(!seen.has(s), s);
});

test('結果コピーの文字列', () => {
  const rows = [
    { result: [X, Y, X, X] },
    { result: [Y, X, G, X] },
    { result: [G, G, G, X] },
    { result: [G, G, G, G] },
  ];
  assert.equal(
    L.shareText({ gen: 4, length: 4, rows, won: true, maxTries: 6 }),
    'ポケもじ 第4世代まで 4文字 4/6\n⬜🟨⬜⬜\n🟨⬜🟩⬜\n🟩🟩🟩⬜\n🟩🟩🟩🟩'
  );
});

test('使った文字の色は最も良いものを残す', () => {
  const m = L.letterStates([
    { guess: 'カイロス', result: [X, G, X, X] },
    { guess: 'イーブイ', result: [Y, X, X, X] },
  ]);
  assert.equal(m.get('イ'), G);
  assert.equal(m.get('カ'), X);
});

test('結果コピーは回数設定と失敗を反映する', () => {
  const rows = Array.from({ length: 10 }, () => ({ result: [X, X, X] }));
  const t = L.shareText({ gen: 9, length: 3, rows, won: false, maxTries: 10 });
  assert.equal(t.split('\n')[0], 'ポケもじ 第9世代まで 3文字 X/10');
  assert.equal(t.split('\n').length, 11);
});

test('文字一覧に名前の文字がすべて1回ずつ並ぶ', () => {
  const usable = new Set(names.flatMap((n) => L.chars(n.name)));
  const blocks = L.kanaLayout(usable);
  const shown = blocks.flat(2).filter((c) => c);
  assert.equal(shown.length, usable.size);
  assert.deepEqual(new Set(shown), usable);
  for (const col of blocks.flat()) assert.equal(col.length, 5);
  // 名前に使われない文字(ヲ など)は出さない
  assert.ok(!shown.includes('ヲ'));
  // 記号は最後の列にまとまる
  assert.deepEqual(blocks.at(-1).at(-1).filter((c) => c).sort(), ['2', 'Z', '♀', '♂'].sort());
});

test('毎日の連続達成', () => {
  let d = L.recordDailyWin(undefined, '2026-12-30');
  assert.deepEqual([d.current, d.max, d.todayWins], [1, 1, 1]);
  d = L.recordDailyWin(d, '2026-12-30'); // 同じ日にもう1問 → 日数は増えない
  assert.deepEqual([d.current, d.todayWins], [1, 2]);
  d = L.recordDailyWin(d, '2026-12-31');
  d = L.recordDailyWin(d, '2027-01-01'); // 年をまたいでも続く
  assert.deepEqual([d.current, d.max, d.todayWins], [3, 3, 1]);
  // 表示: 今日・昨日なら連続中、2日以上空くと0
  assert.equal(L.dailyStatus(d, '2027-01-01').doneToday, true);
  assert.equal(L.dailyStatus(d, '2027-01-02').current, 3);
  assert.equal(L.dailyStatus(d, '2027-01-02').doneToday, false);
  assert.equal(L.dailyStatus(d, '2027-01-03').current, 0);
  // 1日空けてから正解すると1からやり直し、最長は残る
  d = L.recordDailyWin(d, '2027-01-03');
  assert.deepEqual([d.current, d.max], [1, 3]);
  // 3月の月末(うるう年でない)
  assert.equal(L.daysBetween('2027-02-28', '2027-03-01'), 1);
  assert.equal(L.dayKey(new Date(2026, 0, 5)), '2026-01-05');
});

test('ギブアップした結果のコピー', () => {
  const t = L.shareText({ gen: 9, length: 5, rows: [{ result: [X, Y, X, X, G] }], won: false, maxTries: 6, gaveUp: true });
  assert.equal(t, 'ポケもじ 第9世代まで 5文字 X/6 ギブアップ\n⬜🟨⬜⬜🟩');
});

test('短い入力を含む結果コピー', () => {
  const t = L.shareText({ gen: 9, length: 5, rows: [{ result: [G, Y, Y, X] }, { result: [G, G, G, G, G] }], won: true, maxTries: 6 });
  assert.equal(t, 'ポケもじ 第9世代まで 5文字 2/6\n🟩🟨🟨⬜➖\n🟩🟩🟩🟩🟩');
});
