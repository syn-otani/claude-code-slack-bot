import { query, type SDKMessage } from '@anthropic-ai/claude-code';
import { ConversationSession } from './types';
import { Logger } from './logger';
import { McpManager, McpServerConfig } from './mcp-manager';
import { permissionHandler } from './permission-handler';
import { bypassModeManager } from './bypass-mode-manager';
import path from 'path';

// Get the directory where this file is located
const __dirname = path.dirname(new URL(import.meta.url).pathname);

export class ClaudeHandler {
  private sessions: Map<string, ConversationSession> = new Map();
  private logger = new Logger('ClaudeHandler');
  private mcpManager: McpManager;

  constructor(mcpManager: McpManager) {
    this.mcpManager = mcpManager;
  }

  getSessionKey(userId: string, channelId: string, threadTs?: string): string {
    return `${userId}-${channelId}-${threadTs || 'direct'}`;
  }

  getSession(userId: string, channelId: string, threadTs?: string): ConversationSession | undefined {
    return this.sessions.get(this.getSessionKey(userId, channelId, threadTs));
  }

  createSession(userId: string, channelId: string, threadTs?: string): ConversationSession {
    const session: ConversationSession = {
      userId,
      channelId,
      threadTs,
      isActive: true,
      lastActivity: new Date(),
    };
    this.sessions.set(this.getSessionKey(userId, channelId, threadTs), session);
    return session;
  }

  async *streamQuery(
    prompt: string,
    session?: ConversationSession,
    abortController?: AbortController,
    workingDirectory?: string,
    slackContext?: { channel: string; threadTs?: string; user: string }
  ): AsyncGenerator<SDKMessage, void, unknown> {
    // Check if bypass mode is enabled for this channel/thread
    const isBypassMode = slackContext
      ? bypassModeManager.isBypassMode(
          slackContext.channel,
          slackContext.threadTs,
          slackContext.channel.startsWith('D') ? slackContext.user : undefined
        )
      : true; // No Slack context means bypass by default

    const options: any = {
      outputFormat: 'stream-json',
      // Use 'bypassPermissions' if bypass mode is on, otherwise 'default' with approval
      permissionMode: isBypassMode ? 'bypassPermissions' : 'default',
    };

    // Add canUseTool callback for Slack-based permission approval (only if not in bypass mode)
    if (slackContext && !isBypassMode) {
      options.canUseTool = permissionHandler.createCanUseToolCallback(slackContext);
      this.logger.debug('Added canUseTool callback for Slack permission approval', slackContext);
    }

    this.logger.debug('Permission mode determined', {
      isBypassMode,
      permissionMode: options.permissionMode,
      hasSlackContext: !!slackContext
    });

    if (workingDirectory) {
      options.cwd = workingDirectory;
    }

    // Add MCP server configuration if available
    const mcpServers = this.mcpManager.getServerConfiguration();

    if (mcpServers && Object.keys(mcpServers).length > 0) {
      options.mcpServers = mcpServers;
    }

    if (options.mcpServers && Object.keys(options.mcpServers).length > 0) {
      // Allow all MCP tools by default
      const defaultMcpTools = this.mcpManager.getDefaultAllowedTools();
      if (defaultMcpTools.length > 0) {
        options.allowedTools = defaultMcpTools;
      }

      this.logger.debug('Added MCP configuration to options', {
        serverCount: Object.keys(options.mcpServers).length,
        servers: Object.keys(options.mcpServers),
        allowedTools: defaultMcpTools,
        hasSlackContext: !!slackContext,
      });
    }

    if (session?.sessionId) {
      options.resume = session.sessionId;
      this.logger.debug('Resuming session', { sessionId: session.sessionId });
    } else {
      this.logger.debug('Starting new Claude conversation');
    }

    this.logger.debug('Claude query options', options);

    // Add abort controller to options
    options.abortController = abortController || new AbortController();

    try {
      for await (const message of query({
        prompt,
        options,
      })) {
        if (message.type === 'system' && message.subtype === 'init') {
          if (session) {
            session.sessionId = message.session_id;
            this.logger.info('Session initialized', { 
              sessionId: message.session_id,
              model: (message as any).model,
              tools: (message as any).tools?.length || 0,
            });
          }
        }
        yield message;
      }
    } catch (error) {
      this.logger.error('Error in Claude query', error);
      throw error;
    }
  }

  cleanupInactiveSessions(maxAgeHours: number = 24) {
    // If maxAgeHours is 0 or negative, never clean up sessions
    if (maxAgeHours <= 0) {
      this.logger.debug('Session cleanup disabled (timeout set to 0)');
      return;
    }

    const maxAge = maxAgeHours * 60 * 60 * 1000; // Convert hours to milliseconds
    const now = Date.now();
    let cleaned = 0;
    for (const [key, session] of this.sessions.entries()) {
      if (now - session.lastActivity.getTime() > maxAge) {
        this.sessions.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      this.logger.info(`Cleaned up ${cleaned} inactive sessions (timeout: ${maxAgeHours}h)`);
    }
  }

  /**
   * Get all sessions (for backup)
   */
  getAllSessions(): Map<string, ConversationSession> {
    return this.sessions;
  }

  /**
   * Restore sessions from backup
   */
  restoreSessions(sessions: Map<string, ConversationSession>): void {
    for (const [key, session] of sessions.entries()) {
      this.sessions.set(key, session);
    }
    this.logger.info(`Restored ${sessions.size} sessions from backup`);
  }

  /**
   * Set a session directly (for restoration)
   */
  setSession(key: string, session: ConversationSession): void {
    this.sessions.set(key, session);
  }

  /**
   * Attach an external session ID (from PC Claude Code) to a Slack session
   */
  attachExternalSession(userId: string, channelId: string, threadTs: string | undefined, externalSessionId: string): ConversationSession {
    const key = this.getSessionKey(userId, channelId, threadTs);

    // Create or update session with the external sessionId
    const session: ConversationSession = {
      userId,
      channelId,
      threadTs,
      sessionId: externalSessionId,
      isActive: true,
      lastActivity: new Date(),
    };

    this.sessions.set(key, session);
    this.logger.info('Attached external session', {
      key,
      externalSessionId,
      userId,
      channelId,
      threadTs
    });

    return session;
  }

  /**
   * Get session ID for a given context
   */
  getSessionId(userId: string, channelId: string, threadTs?: string): string | undefined {
    const session = this.getSession(userId, channelId, threadTs);
    return session?.sessionId;
  }
}