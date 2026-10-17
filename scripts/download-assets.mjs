#!/usr/bin/env node
// Friend-facing asset download (下载素材.bat). Installs dependencies, then runs setup with the
// download window enabled (SP_ASSET_WINDOW=1): the console title and each progress line show how
// many bytes this run has transferred. Safe to stop and run again; finished files are skipped.
//
//   node scripts/download-assets.mjs

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkAssets } from '../tools/setup.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function npmCommand() {
  const beside = path.join(path.dirname(process.execPath), process.platform === 'win32' ? 'npm.cmd' : 'npm');
  return fs.existsSync(beside) ? beside : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
}

function depsReady() {
  return fs.existsSync(path.join(ROOT, 'node_modules', 'ws', 'package.json'));
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });
  return r.status === 0;
}

function installDeps() {
  if (depsReady()) return true;
  process.title = '卫戍协议 - 正在安装程序文件（第一次）';
  console.log('\n正在安装运行所需的程序文件（第一次需要几分钟，之后会跳过）…\n');
  const npm = npmCommand();
  if (run(npm, ['ci', '--no-audit', '--no-fund'])) return depsReady();
  console.log('\n官方下载源失败，改用国内镜像再试一次…\n');
  if (run(npm, ['ci', '--no-audit', '--no-fund', '--registry', 'https://registry.npmmirror.com'])) return depsReady();
  console.log('\n安装程序文件失败。请检查网络，然后重新双击「下载素材.bat」。\n');
  return false;
}

function main() {
  process.env.SP_ASSET_WINDOW = '1';
  if (!installDeps()) return 1;
  process.title = '卫戍协议 - 正在下载素材';
  console.log('\n开始下载素材（大约 720 MB）。');
  console.log('请看本窗口标题上的「已下载 … MB」。中途关掉也可以，再次双击会接着下载。\n');
  const r = spawnSync(process.execPath, [
    path.join(ROOT, 'tools', 'setup.mjs'), '--no-local', '--no-scenes', '-y',
  ], { cwd: ROOT, stdio: 'inherit', env: process.env });
  const assets = checkAssets();
  if (r.status !== 0 || !assets.ok) {
    const left = assets.missing ? `还缺 ${assets.missing} 个文件。` : '';
    console.log(`\n素材没有下完。${left}请检查网络，然后重新双击「下载素材.bat」（已下载的会跳过）。\n`);
    return r.status || 1;
  }
  process.title = '卫戍协议 - 素材下载完成';
  console.log('\n素材已准备好。请关掉本窗口，再双击「启动游戏.bat」。\n');
  return 0;
}

const code = main();
process.exitCode = code;
