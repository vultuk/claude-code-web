const assert = require('assert');
const { ClaudeCodeWebServer } = require('../src/server');

describe('Server Aliases', function() {
  it('should set aliases from options', function() {
    const server = new ClaudeCodeWebServer({
      claudeAlias: 'Buddy',
      codexAlias: 'Robo',
      agentAlias: 'Helper',
      noAuth: true // avoid auth middleware complexity
    });

    assert.strictEqual(server.aliases.claude, 'Buddy');
    assert.strictEqual(server.aliases.codex, 'Robo');
    assert.strictEqual(server.aliases.agent, 'Helper');
  });

  it('should default aliases when not provided', function() {
    const server = new ClaudeCodeWebServer({ noAuth: true });
    assert.ok(server.aliases.claude && server.aliases.claude.length > 0);
    assert.ok(server.aliases.codex && server.aliases.codex.length > 0);
    assert.ok(server.aliases.agent && server.aliases.agent.length > 0);
  });
});

