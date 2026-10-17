import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assetWindowStatus } from '../tools/assets/downloader.mjs';

test('asset window status names the bytes downloaded so far', () => {
  const s = assetWindowStatus({ done: 3, total: 10, bytes: 2.5 * 1048576, secs: 2, ok: 2, skip: 1, error: 0 });
  assert.equal(s.line, '当前下载量 2.5 MB    文件 3/10    速度 1.3 MB/s    新下 2  已有 1  失败 0');
  assert.equal(s.title, '卫戍协议 已下载 2.5 MB  (3/10)');
});
