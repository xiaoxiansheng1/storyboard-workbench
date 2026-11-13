import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { roundTo, clampNumber, clampInt, pad2 } from '../utils/num.mjs';
import { fileTimestamp, dayKey } from '../utils/time.mjs';
import { newId } from '../utils/id.mjs';
import { sha1Short } from '../utils/digest.mjs';
import { messageOf, errorText } from '../utils/message.mjs';
import { delay, isRetryable, withRetry } from '../utils/retry.mjs';
import { readJsonSafe, writeJsonAtomic } from '../utils/json-file.mjs';
import { parseCsv } from '../utils/csv.mjs';

test('roundTo 按位数四舍五入', () => {
  assert.equal(roundTo(1.2345, 2), 1.23);
  assert.equal(roundTo(1.2355, 3), 1.236);
  assert.equal(roundTo(1.005, 2), 1);
  assert.ok(Number.isNaN(roundTo(NaN, 2)));
  assert.equal(roundTo(Infinity, 2), Infinity);
});

test('clampNumber 非法数字回退默认值', () => {
  assert.equal(clampNumber('5', 0, 10, 3), 5);
  assert.equal(clampNumber(15, 0, 10, 3), 10);
  assert.equal(clampNumber(-1, 0, 10, 3), 0);
  assert.equal(clampNumber('abc', 0, 10, 3), 3);
  assert.equal(clampNumber(NaN, 0, 10, 3), 3);
});

test('clampInt 截断为整数并夹取', () => {
  assert.equal(clampInt('5.9', 1, 8, 1), 5);
  assert.equal(clampInt(100, 1, 8, 1), 8);
  assert.equal(clampInt(0, 1, 8, 1), 1);
  assert.equal(clampInt('abc', 1, 8, 1), 1);
});

test('pad2 补零，空值退化为 0 补齐（沿用旧 mock 语义）', () => {
  assert.equal(pad2(5), '05');
  assert.equal(pad2(12), '12');
  assert.equal(pad2(null), '00');
  assert.equal(pad2(undefined), '00');
  assert.equal(pad2('7'), '07');
});

test('fileTimestamp 输出 YYYYMMDD-HHMMSS', () => {
  assert.equal(fileTimestamp(new Date(2026, 0, 2, 3, 4, 5)), '20260102-030405');
});

test('dayKey 输出 YYYY-MM-DD', () => {
  assert.equal(dayKey(new Date(2026, 10, 11)), '2026-11-11');
  assert.equal(dayKey(new Date(0)).length, 10);
});

test('newId 前缀 + 基36时间 + 6位随机十六进制', () => {
  const ids = new Set();
  for (let i = 0; i < 20; i += 1) ids.add(newId('p'));
  for (const id of ids) {
    assert.match(id, /^p-[a-z0-9]+-[0-9a-f]{6}$/);
  }
  assert.ok(ids.size > 1);
  assert.match(newId('audio'), /^audio-[a-z0-9]+-[0-9a-f]{6}$/);
});

test('sha1Short 输出12位十六进制', () => {
  assert.equal(sha1Short('hello'), cryptoHash('hello'));
  assert.equal(sha1Short(''), cryptoHash(''));
  assert.equal(sha1Short('中文'), cryptoHash('中文'));

  function cryptoHash(raw) {
    return crypto.createHash('sha1').update(String(raw)).digest('hex').slice(0, 12);
  }
});

test('messageOf 取 error.message 或字符串化', () => {
  assert.equal(messageOf(new Error('boom')), 'boom');
  assert.equal(messageOf('plain'), 'plain');
  assert.equal(messageOf(42), '42');
  assert.equal(messageOf(null), 'null');
  assert.equal(messageOf(undefined), 'undefined');
});

test('errorText 合并两个 provider 的分支', () => {
  assert.equal(errorText({ error: 'E' }, 'raw'), 'E');
  assert.equal(errorText({ error: { message: 'M' } }, 'raw'), 'M');
  assert.equal(errorText({ message: 'msg' }, 'raw'), 'msg');
  assert.equal(errorText({ detail: 'D' }, 'raw'), 'D');
  assert.equal(errorText({}, 'raw'), 'raw');
  assert.equal(errorText({}, 'x'.repeat(400)), 'x'.repeat(300));
  assert.equal(errorText(null, 'raw'), 'raw');
});

test('isRetryable 识别网络类错误', () => {
  for (const msg of ['HTTP 500: x', 'HTTP 429: y', 'fetch failed', 'ECONNRESET', 'EAI_AGAIN']) {
    assert.ok(isRetryable({ message: msg }), msg);
  }
  assert.ok(!isRetryable({ message: 'HTTP 400: bad' }));
  assert.ok(!isRetryable({ message: 'quota exceeded' }));
});

test('withRetry 对可重试错误重试、对其他错误直接抛出', async () => {
  let calls = 0;
  const ok = await withRetry(async () => {
    calls += 1;
    if (calls === 1) throw new Error('HTTP 502: bad gateway');
    return 'ok';
  });
  assert.equal(ok, 'ok');
  assert.equal(calls, 2);

  let postCalls = 0;
  await assert.rejects(
    withRetry(async () => {
      postCalls += 1;
      throw new Error('HTTP 400: bad request');
    }),
    /HTTP 400/,
  );
  assert.equal(postCalls, 1);

  await assert.rejects(
    withRetry(async () => {
      throw new Error('HTTP 502: still bad');
    }, 2),
    /HTTP 502/,
  );
});

test('delay 至少等待指定毫秒', async () => {
  const start = Date.now();
  await delay(30);
  assert.ok(Date.now() - start >= 25);
});

test('readJsonSafe 损坏文件回退、map 抛错回退', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utils-json-'));
  const file = path.join(dir, 'x.json');
  fs.writeFileSync(file, '{broken', 'utf8');
  assert.equal(readJsonSafe(file, 'fallback'), 'fallback');

  fs.writeFileSync(file, 'null', 'utf8');
  const normalize = (v) => {
    if (v === null) throw new Error('normalize null');
    return { ok: true };
  };
  assert.deepEqual(readJsonSafe(file, { ok: false }, normalize), { ok: false });

  fs.writeFileSync(file, '{"a":1}', 'utf8');
  assert.deepEqual(readJsonSafe(file, null), { a: 1 });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('writeJsonAtomic 默认缩进、可选紧凑、原子替换', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utils-json-'));
  const file = path.join(dir, 'y.json');
  writeJsonAtomic(file, { a: 1 });
  assert.equal(fs.readFileSync(file, 'utf8'), JSON.stringify({ a: 1 }, null, 2));
  writeJsonAtomic(file, { a: 1 }, false);
  assert.equal(fs.readFileSync(file, 'utf8'), JSON.stringify({ a: 1 }));
  assert.ok(!fs.existsSync(`${file}.tmp`));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('parseCsv 解析带引号与换行的单元格', () => {
  const rows = parseCsv('a,b\n"1,5","line1\nline2"\n3,4');
  assert.deepEqual(rows, [
    ['a', 'b'],
    ['1,5', 'line1\nline2'],
    ['3', '4'],
  ]);
});
