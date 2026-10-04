#!/usr/bin/env node
// names.json を PokéAPI のポケモン種族データから生成する。
// 使い方: node scripts/build-names.js
// 出力: リポジトリ直下の names.json(5文字以下の名前のみ)
'use strict';

const fs = require('fs');
const path = require('path');
const { normalize } = require('../logic.js');

const API = 'https://pokeapi.co/api/v2';
const LANG_CANDIDATES = ['ja-Hrkt', 'ja']; // カタカナ表記を優先
const MAX_LEN = 5;
const CONCURRENCY = 16;
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };

async function getJson(url, retries = 3) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return await res.json();
    } catch (e) {
      if (i >= retries) throw e;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return out;
}

async function main() {
  const list = await getJson(`${API}/pokemon-species?limit=100000`);
  console.log(`種族数: ${list.results.length}`);

  let done = 0;
  const species = await mapLimit(list.results, CONCURRENCY, async (s) => {
    const d = await getJson(s.url);
    if (++done % 100 === 0) process.stderr.write(`  ${done}/${list.results.length}\n`);
    let entry = null;
    for (const lang of LANG_CANDIDATES) {
      entry = d.names.find((n) => n.language.name === lang);
      if (entry) break;
    }
    const genKey = d.generation.name.replace('generation-', '');
    return { no: d.id, name: entry ? entry.name : null, gen: ROMAN[genKey] || null, en: d.name };
  });

  const missing = species.filter((s) => !s.name || !s.gen);
  if (missing.length) {
    console.warn('日本語名または世代が取得できなかった種族:');
    for (const m of missing) console.warn(`  No.${m.no} ${m.en} name=${m.name} gen=${m.gen}`);
  }

  const all = species
    .filter((s) => s.name && s.gen)
    .map((s) => ({ no: s.no, name: normalize(s.name), gen: s.gen }))
    .sort((a, b) => a.no - b.no);

  const outOfRange = all.filter((s) => s.gen > 9);
  if (outOfRange.length) console.warn(`第10世代以降のデータが ${outOfRange.length} 件あります(仕様は第9世代まで)`);

  const picked = all.filter((s) => Array.from(s.name).length <= MAX_LEN);
  const skipped = all.filter((s) => Array.from(s.name).length > MAX_LEN);

  fs.writeFileSync(
    path.join(__dirname, '..', 'names.json'),
    '[\n' + picked.map((p) => '  ' + JSON.stringify(p)).join(',\n') + '\n]\n'
  );

  // ---- 確認用レポート ----
  console.log(`\n全 ${all.length} 件中、${MAX_LEN}文字以下 ${picked.length} 件を names.json に出力`);
  console.log('\n世代ごとの件数(5文字以下 / 全体):');
  for (let g = 1; g <= 9; g++) {
    const a = picked.filter((p) => p.gen === g).length;
    const b = all.filter((p) => p.gen === g).length;
    console.log(`  第${g}世代: ${a} / ${b}`);
  }
  console.log('\n文字数ごとの件数:');
  for (let n = 1; n <= MAX_LEN; n++) {
    console.log(`  ${n}文字: ${picked.filter((p) => Array.from(p.name).length === n).length}`);
  }
  const kana = /^[ァ-ヺー]+$/;
  console.log('\nカタカナ・長音以外の文字を含む名前:');
  for (const p of all.filter((p) => !kana.test(p.name))) {
    const len = Array.from(p.name).length;
    console.log(`  No.${p.no} ${p.name} (${len}文字${len > MAX_LEN ? '・対象外' : ''}) [${Array.from(p.name).join('|')}]`);
  }
  console.log(`\n${MAX_LEN + 1}文字以上で対象外になった名前の例: ${skipped.slice(0, 10).map((s) => s.name).join('、')} ほか`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
