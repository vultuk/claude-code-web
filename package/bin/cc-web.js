#!/usr/bin/env node

const { Command } = require('commander');
const path = require('path');
const open = require('open');
const { startServer } = require('../src/server');

const program = new Command();

program
  .name('cc-web')
  .description('Web-based interface for Claude Code CLI')
  .version('1.11.14')
  .option('-p, --port <number>', 'port to run the server on', '32352')
  .option('--no-open', 'do not automatically open browser')
  .option('--auth <token>', 'authentication token for secure access')
  .option('--https', 'enable HTTPS (requires cert files)')
  .option('--cert <path>', 'path to SSL certificate file')
  .option('--key <path>', 'path to SSL private key file')
  .option('--dev', 'development mode with additional logging')
  .parse();

const options = program.opts();

async function main() {
  try {
    const port = parseInt(options.port, 10);
    
    if (isNaN(port) || port < 1 || port > 65535) {
      console.error('Error: Port must be a number between 1 and 65535');
      process.exit(1);
    }

    const serverOptions = {
      port,
      auth: options.auth,
      https: options.https,
      cert: options.cert,
      key: options.key,
      dev: options.dev,
      folderMode: true // Always use folder mode
    };

    console.log('Starting Claude Code Web Interface...');
    console.log(`Port: ${port}`);
    console.log('Mode: Folder selection mode');
    
    if (options.auth) {
      console.log('Authentication: Enabled');
    }

    const server = await startServer(serverOptions);
    
    const protocol = options.https ? 'https' : 'http';
    const url = `${protocol}://localhost:${port}`;
    
    console.log(`\n🚀 Claude Code Web Interface is running at: ${url}`);
    console.log('\nPress Ctrl+C to stop the server\n');

    if (options.open) {
      try {
        await open(url);
      } catch (error) {
        console.warn('Could not automatically open browser:', error.message);
      }
    }

    process.on('SIGINT', () => {
      console.log('\nShutting down server...');
      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });
    });

    process.on('SIGTERM', () => {
      console.log('\nShutting down server...');
      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });
    });

  } catch (error) {
    console.error('Error starting server:', error.message);
    process.exit(1);
  }
}

main();