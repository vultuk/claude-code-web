const assert = require('assert');
const ClaudeBridge = require('../src/claude-bridge');

describe('ClaudeBridge', function() {
  let bridge;

  beforeEach(function() {
    bridge = new ClaudeBridge();
  });

  describe('constructor', function() {
    it('should initialize with a Map for sessions', function() {
      assert(bridge.sessions instanceof Map);
      assert.strictEqual(bridge.sessions.size, 0);
    });

    it('should find a claude command on initialization', function() {
      assert(typeof bridge.claudeCommand === 'string');
      assert(bridge.claudeCommand.length > 0);
    });
  });

  describe('commandExists', function() {
    it('should return true for existing commands like "ls"', function() {
      const result = bridge.commandExists('ls');
      assert.strictEqual(result, true);
    });

    it('should return false for non-existent commands', function() {
      const result = bridge.commandExists('nonexistentcommand12345');
      assert.strictEqual(result, false);
    });

    it('should handle command names with special characters safely', function() {
      // This tests the security fix - commands with shell metacharacters should not break
      const result = bridge.commandExists('ls; echo "injected"');
      assert.strictEqual(result, false);
    });
  });

  describe('getSession', function() {
    it('should return undefined for non-existent session', function() {
      const result = bridge.getSession('nonexistent');
      assert.strictEqual(result, undefined);
    });
  });

  describe('getAllSessions', function() {
    it('should return empty array when no sessions exist', function() {
      const result = bridge.getAllSessions();
      assert(Array.isArray(result));
      assert.strictEqual(result.length, 0);
    });
  });
});