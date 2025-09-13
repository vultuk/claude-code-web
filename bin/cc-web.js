#!/usr/bin/env node

const { Command } = require('commander');
const path = require('path');
const open = require('open');
const crypto = require('crypto');
const { startServer } = require('../src/server');

const program = new Command();

program
  .name('cc-web')
  .description('Web-based interface for Claude Code CLI')
  .version('3.0.1')
  .option('-p, --port <number>', 'port to run the server on', '32352')
  .option('--no-open', 'do not automatically open browser')
  .option('--auth <token>', 'authentication token for secure access')
  .option('--disable-auth', 'disable authentication (not recommended for production)')
  .option('--https', 'enable HTTPS (requires cert files)')
  .option('--cert <path>', 'path to SSL certificate file')
  .option('--key <path>', 'path to SSL private key file')
  .option('--dev', 'development mode with additional logging')
  .option('--plan <type>', 'subscription plan (pro, max5, max20)', 'max20')
  .option('--claude-alias <name>', 'display alias for Claude (default: env CLAUDE_ALIAS or "Claude")')
  .option('--codex-alias <name>', 'display alias for Codex (default: env CODEX_ALIAS or "Codex")')
  .option('--ngrok-auth-token <token>', 'ngrok auth token to open a public tunnel')
  .option('--ngrok-domain <domain>', 'ngrok reserved domain to use for the tunnel')
  .parse();

const options = program.opts();

function generateRandomToken(length = 10) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function main() {
  try {
    const port = parseInt(options.port, 10);
    
    if (isNaN(port) || port < 1 || port > 65535) {
      console.error('Error: Port must be a number between 1 and 65535');
      process.exit(1);
    }

    // Handle authentication logic
    let authToken = null;
    let noAuth = options.disableAuth === true;
    
    if (!noAuth) {
      if (options.auth) {
        // Use provided token
        authToken = options.auth;
      } else {
        // Generate random token
        authToken = generateRandomToken();
      }
    }

    const serverOptions = {
      port,
      auth: authToken,
      noAuth: noAuth,
      https: options.https,
      cert: options.cert,
      key: options.key,
      dev: options.dev,
      plan: options.plan,
      // UI aliases for assistants
      claudeAlias: options.claudeAlias || process.env.CLAUDE_ALIAS || 'Claude',
      codexAlias: options.codexAlias || process.env.CODEX_ALIAS || 'Codex',
      folderMode: true // Always use folder mode
    };

    console.log('Starting Claude Code Web Interface...');
    console.log(`Port: ${port}`);
    console.log('Mode: Folder selection mode');
    console.log(`Plan: ${options.plan}`);
    console.log(`Aliases: Claude → "${serverOptions.claudeAlias}", Codex → "${serverOptions.codexAlias}"`);
    
    // Display authentication status prominently
    if (noAuth) {
      console.log('\n⚠️  AUTHENTICATION DISABLED - Server is accessible without a token');
      console.log('   (Use without --disable-auth flag for security in production)');
    } else {
      console.log('\n🔐 AUTHENTICATION ENABLED');
      if (options.auth) {
        console.log('   Using provided authentication token');
      } else {
        console.log('   Generated random authentication token:');
        console.log(`   \x1b[1m\x1b[33m${authToken}\x1b[0m`);
        console.log('   \x1b[2mSave this token - you\'ll need it to access the interface\x1b[0m');
      }
    }

    const server = await startServer(serverOptions);

    // ngrok setup
    const hasNgrokToken = !!options.ngrokAuthToken;
    const hasNgrokDomain = !!options.ngrokDomain;

    if ((hasNgrokToken && !hasNgrokDomain) || (!hasNgrokToken && hasNgrokDomain)) {
      console.error('Error: Both --ngrok-auth-token and --ngrok-domain are required to enable ngrok tunneling');
      process.exit(1);
    }

    let ngrokListener = null;
    
    const protocol = options.https ? 'https' : 'http';
    const url = `${protocol}://localhost:${port}`;
    
    console.log(`\n🚀 Claude Code Web Interface is running at: ${url}`);

    if (!noAuth) {
      console.log('\n📋 Authentication Required:');
      if (options.auth) {
        console.log('   Use your provided authentication token to access the interface');
      } else {
        console.log(`   Enter this token when prompted: \x1b[1m\x1b[33m${authToken}\x1b[0m`);
      }
    }
    
    // Start ngrok tunnel if both flags provided
    let publicUrl = null;
    if (hasNgrokToken && hasNgrokDomain) {
      console.log('\n🌐 Starting ngrok tunnel...');
      try {
        const mod = await import('@ngrok/ngrok');
        const ngrok = mod.default || mod;

        if (typeof ngrok.authtoken === 'function') {
          try { await ngrok.authtoken(options.ngrokAuthToken); } catch (_) {}
        }

        ngrokListener = await ngrok.connect({
          addr: port,
          authtoken: options.ngrokAuthToken,
          domain: options.ngrokDomain
        });

        if (ngrokListener && typeof ngrokListener.url === 'function') {
          publicUrl = ngrokListener.url();
        }

        if (!publicUrl && ngrokListener && ngrokListener.url) {
          publicUrl = ngrokListener.url; // fallback in case API exposes property
        }

        if (publicUrl) {
          console.log(`\n🌍 ngrok tunnel established: ${publicUrl}`);
        } else {
          console.log('\n🌍 ngrok tunnel established');
        }

        if (options.open && publicUrl) {
          try { await open(publicUrl); } catch (error) {
            console.warn('Could not automatically open browser:', error.message);
          }
        }

      } catch (error) {
        console.error('Failed to start ngrok tunnel:', error.message);
      }
    } else if (options.open) {
      // Open local URL only when ngrok not used and auto-open enabled
      try {
        await open(url);
      } catch (error) {
        console.warn('Could not automatically open browser:', error.message);
      }
    }

    console.log('\nPress Ctrl+C to stop the server\n');

    const shutdown = async () => {
      console.log('\nShutting down server...');
      // Close ngrok tunnel first if active
      if (ngrokListener && typeof ngrokListener.close === 'function') {
        try { await ngrokListener.close(); } catch (_) {}
      }
      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });
    };

    process.on('SIGINT', () => { shutdown(); });
    process.on('SIGTERM', () => { shutdown(); });

  } catch (error) {
    console.error('Error starting server:', error.message);
    process.exit(1);
  }
}

main();
