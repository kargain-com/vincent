if (!process.argv.includes('--genesis')) {
  process.argv.splice(2, 0, '--genesis');
}

void import('./publish-epoch.js');
