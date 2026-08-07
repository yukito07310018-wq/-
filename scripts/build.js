#!/usr/bin/env node

const { execSync } = require('child_process');

async function build() {
  try {
    console.log('Running next build...');
    execSync('next build', { stdio: 'inherit' });
  } catch (error) {
    console.error('Build failed:', error.message);
    process.exit(1);
  }
}

build();
