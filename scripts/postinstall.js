#!/usr/bin/env node
/**
 * Post-install script: ensure node-pty's spawn-helper binaries are executable.
 *
 * When npm installs a package, file permissions from the tarball are not always
 * preserved on macOS. node-pty's spawn-helper binary must be executable or
 * node-pty will throw "posix_spawnp failed" on every pty.spawn() call.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const prebuildsDirs = [
  path.join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds'),
];

let fixed = 0;
for (const prebuildsDir of prebuildsDirs) {
  if (!fs.existsSync(prebuildsDir)) continue;
  for (const platform of fs.readdirSync(prebuildsDir)) {
    const helperPath = path.join(prebuildsDir, platform, 'spawn-helper');
    if (!fs.existsSync(helperPath)) continue;
    const mode = fs.statSync(helperPath).mode;
    const execBit = 0o111;
    if ((mode & execBit) !== execBit) {
      fs.chmodSync(helperPath, mode | execBit);
      console.log(`Fixed permissions for ${helperPath}`);
      fixed++;
    }
  }
}

if (fixed > 0) {
  console.log(`postinstall: fixed execute permissions on ${fixed} spawn-helper file(s).`);
}
