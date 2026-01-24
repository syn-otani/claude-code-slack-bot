import { App } from '@slack/bolt';
import { config, validateConfig } from './config';
import { ClaudeHandler } from './claude-handler';
import { SlackHandler } from './slack-handler';
import { McpManager } from './mcp-manager';
import { Logger } from './logger';
import { SessionBackupManager } from './session-backup';

const logger = new Logger('Main');

async function start() {
  try {
    // Validate configuration
    validateConfig();

    logger.info('Starting Claude Code Slack bot', {
      debug: config.debug,
      useBedrock: config.claude.useBedrock,
      useVertex: config.claude.useVertex,
    });

    // Initialize Slack app
    const app = new App({
      token: config.slack.botToken,
      signingSecret: config.slack.signingSecret,
      socketMode: true,
      appToken: config.slack.appToken,
    });

    // Initialize MCP manager
    const mcpManager = new McpManager();
    const mcpConfig = mcpManager.loadConfiguration();

    // Initialize handlers
    const claudeHandler = new ClaudeHandler(mcpManager);
    const slackHandler = new SlackHandler(app, claudeHandler, mcpManager);

    // Initialize session backup manager
    const backupManager = new SessionBackupManager();

    // Restore sessions from backup if available
    const backup = backupManager.loadBackup();
    if (backup) {
      const { sessions, workingDirectories } = backupManager.restoreSessions(backup);
      claudeHandler.restoreSessions(sessions);
      slackHandler.restoreWorkingDirectories(workingDirectories);
      logger.info('Sessions restored from backup', {
        sessionCount: sessions.size,
        workingDirCount: workingDirectories.size,
        backupTime: backup.timestamp,
      });
    }

    // Start periodic backup (every 30 minutes)
    backupManager.startPeriodicBackup(
      () => claudeHandler.getAllSessions(),
      () => slackHandler.getWorkingDirectories(),
      30 // minutes
    );

    // Save backup on shutdown
    const shutdown = () => {
      logger.info('Shutting down, saving session backup...');
      backupManager.saveBackup(
        claudeHandler.getAllSessions(),
        slackHandler.getWorkingDirectories()
      );
      backupManager.stopPeriodicBackup();
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    // Setup event handlers
    slackHandler.setupEventHandlers();

    // Start the app
    await app.start();
    logger.info('⚡️ Claude Code Slack bot is running!');
    logger.info('Configuration:', {
      usingBedrock: config.claude.useBedrock,
      usingVertex: config.claude.useVertex,
      usingAnthropicAPI: !config.claude.useBedrock && !config.claude.useVertex,
      debugMode: config.debug,
      baseDirectory: config.baseDirectory || 'not set',
      mcpServers: mcpConfig ? Object.keys(mcpConfig.mcpServers).length : 0,
      mcpServerNames: mcpConfig ? Object.keys(mcpConfig.mcpServers) : [],
      sessionBackupDir: backupManager.getBackupDir(),
    });
  } catch (error) {
    logger.error('Failed to start the bot', error);
    process.exit(1);
  }
}

start();