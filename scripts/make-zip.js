'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_DIR = path.resolve(__dirname, '..');
const OUTPUT_ZIP = path.join(PROJECT_DIR, '..', 'Sadarshop-ready-to-share.zip');
const STAGING_DIR = path.join(PROJECT_DIR, '..', 'Sadarshop-export-temp');

console.log('Packaging Sadarshop for sharing...');

if (fs.existsSync(STAGING_DIR)) {
  fs.rmSync(STAGING_DIR, { recursive: true, force: true });
}
if (fs.existsSync(OUTPUT_ZIP)) {
  fs.rmSync(OUTPUT_ZIP, { force: true });
}

fs.mkdirSync(STAGING_DIR, { recursive: true });

const filesToCopy = [
  'server.js',
  'start.bat',
  'start.command',
  'package.json',
  'reset-password.js',
  'README.md',
  '.gitignore'
];

const dirsToCopy = [
  'src',
  'views',
  'public',
  'data'
];

// Copy standalone files
for (const file of filesToCopy) {
  const src = path.join(PROJECT_DIR, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(STAGING_DIR, file));
  }
}

// Copy directories
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    // Ignore transient files
    if (entry.name.endsWith('-wal') || entry.name.endsWith('-shm') || entry.name.endsWith('-journal')) {
      continue;
    }
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

for (const dir of dirsToCopy) {
  const src = path.join(PROJECT_DIR, dir);
  if (fs.existsSync(src)) {
    copyDir(src, path.join(STAGING_DIR, dir));
  }
}

// Rename staging directory to 'Sadarshop' for clean unzipping
const FINAL_STAGING = path.join(PROJECT_DIR, '..', 'Sadarshop');
// Since our source is currently called Sadarshop, we'll zip from parent
try {
  console.log('Creating ZIP archive...');
  // Use tar to compress staging dir into zip
  execSync(`tar -a -c -f "${OUTPUT_ZIP}" -C "${path.dirname(STAGING_DIR)}" "${path.basename(STAGING_DIR)}"`, { stdio: 'inherit' });
  console.log(`\nSUCCESS! Created portable package:`);
  console.log(`Path: ${OUTPUT_ZIP}`);
  const stat = fs.statSync(OUTPUT_ZIP);
  console.log(`Size: ${(stat.size / (1024 * 1024)).toFixed(2)} MB`);
} finally {
  if (fs.existsSync(STAGING_DIR)) {
    fs.rmSync(STAGING_DIR, { recursive: true, force: true });
  }
}
