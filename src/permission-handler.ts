import { WebClient } from '@slack/web-api';
import { Logger } from './logger';
import * as fs from 'fs';
import * as path from 'path';

const logger = new Logger('PermissionHandler');

// Directory for approval communication files
const APPROVAL_DIR = path.join(process.env.HOME || '/tmp', '.claude-code-slack-bot', 'approvals');

export interface PermissionResult {
  behavior: 'allow' | 'deny';
  updatedInput?: Record<string, unknown>;
  message?: string;
}

interface SlackContext {
  channel: string;
  threadTs?: string;
  user: string;
}

// Dangerous patterns that should be blocked in auto mode
const DANGEROUS_BASH_PATTERNS = [
  // File deletion - recursive/force with dangerous targets
  /rm\s+(-[rRf]+\s+)*[^\s]*(\*|\/\s*$|~|\.\.)/,  // rm -rf *, rm /, rm ~, rm ..
  /rm\s+-[rRf]*\s+\//,  // rm -rf /anything

  // Git destructive operations
  /git\s+push\s+.*--force/,
  /git\s+push\s+-f/,
  /git\s+reset\s+--hard/,
  /git\s+clean\s+-[fdx]/,
  /git\s+checkout\s+\.\s*$/,
  /git\s+restore\s+\.\s*$/,

  // Permission/ownership changes
  /sudo\s+/,
  /chmod\s+(-R\s+)?777/,
  /chown\s+-R/,

  // Remote code execution
  /curl\s+[^|]*\|\s*(sh|bash|zsh)/,
  /wget\s+[^|]*\|\s*(sh|bash|zsh)/,

  // Environment variable exposure
  /^\s*env\s*$/,
  /^\s*printenv\s*$/,
  /cat\s+[^\s]*\.env/,

  // Process/service manipulation
  /kill\s+-9\s+/,
  /pkill\s+/,
  /killall\s+/,
  /launchctl\s+(unload|remove|bootout)/,

  // Package publishing
  /npm\s+publish/,
  /yarn\s+publish/,

  // Disk operations
  /mkfs\./,
  /dd\s+if=/,
  /fdisk/,
];

/**
 * Check if a bash command matches any dangerous pattern
 */
function isDangerousBashCommand(command: string): { dangerous: boolean; reason?: string } {
  for (const pattern of DANGEROUS_BASH_PATTERNS) {
    if (pattern.test(command)) {
      return {
        dangerous: true,
        reason: `Command matches dangerous pattern: ${pattern.toString()}`
      };
    }
  }
  return { dangerous: false };
}

/**
 * Check if a file path is within the working directory
 */
function isWithinWorkingDirectory(filePath: string, workingDirectory: string): boolean {
  const resolvedPath = path.resolve(workingDirectory, filePath);
  const resolvedWorkingDir = path.resolve(workingDirectory);
  return resolvedPath.startsWith(resolvedWorkingDir + path.sep) || resolvedPath === resolvedWorkingDir;
}

/**
 * Check if tool operation is dangerous in auto mode
 */
export function checkAutoModeSafety(
  toolName: string,
  input: Record<string, unknown>,
  workingDirectory?: string
): { safe: boolean; reason?: string } {
  // Bash command check
  if (toolName === 'Bash' && typeof input.command === 'string') {
    const result = isDangerousBashCommand(input.command);
    if (result.dangerous) {
      return { safe: false, reason: result.reason };
    }
  }

  // File operation outside working directory check
  if (workingDirectory && (toolName === 'Write' || toolName === 'Edit' || toolName === 'MultiEdit')) {
    const filePath = input.file_path as string;
    if (filePath && !isWithinWorkingDirectory(filePath, workingDirectory)) {
      return {
        safe: false,
        reason: `File path "${filePath}" is outside working directory "${workingDirectory}"`
      };
    }
  }

  return { safe: true };
}

// Ensure approval directory exists
function ensureApprovalDir() {
  if (!fs.existsSync(APPROVAL_DIR)) {
    fs.mkdirSync(APPROVAL_DIR, { recursive: true });
  }
}

export class PermissionHandler {
  private slack: WebClient;

  constructor() {
    this.slack = new WebClient(process.env.SLACK_BOT_TOKEN);
  }

  /**
   * Creates a canUseTool callback for Claude Code SDK
   */
  createCanUseToolCallback(slackContext: SlackContext) {
    return async (
      toolName: string,
      input: Record<string, unknown>,
      options: { signal: AbortSignal; suggestions?: any[] }
    ): Promise<PermissionResult> => {
      logger.info('Permission requested for tool', { toolName, input });

      // Generate unique approval ID
      const approvalId = `approval_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Send approval request to Slack
      const mentionText = slackContext.user ? `<@${slackContext.user}> ` : '';
      const blocks = [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${mentionText}🔐 *Permission Request*\n\nClaude wants to use the tool: \`${toolName}\`\n\n*Tool Parameters:*\n\`\`\`json\n${JSON.stringify(input, null, 2)}\n\`\`\``
          }
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "✅ Approve"
              },
              style: "primary",
              action_id: "approve_tool",
              value: approvalId
            },
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "❌ Deny"
              },
              style: "danger",
              action_id: "deny_tool",
              value: approvalId
            }
          ]
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `Requested by: <@${slackContext.user}> | Tool: ${toolName}`
            }
          ]
        }
      ];

      try {
        const result = await this.slack.chat.postMessage({
          channel: slackContext.channel,
          thread_ts: slackContext.threadTs,
          blocks,
          text: `${mentionText}Permission request for ${toolName}`
        });

        // Wait for user response via file polling
        const response = await this.waitForApproval(approvalId, options.signal);

        // Update the message to show the result
        if (result.ts) {
          await this.slack.chat.update({
            channel: result.channel!,
            ts: result.ts,
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `🔐 *Permission Request* - ${response.behavior === 'allow' ? '✅ Approved' : '❌ Denied'}\n\nTool: \`${toolName}\`\n\n*Tool Parameters:*\n\`\`\`json\n${JSON.stringify(input, null, 2)}\n\`\`\``
                }
              },
              {
                type: "context",
                elements: [
                  {
                    type: "mrkdwn",
                    text: `${response.behavior === 'allow' ? 'Approved' : 'Denied'} by user | Tool: ${toolName}`
                  }
                ]
              }
            ],
            text: `Permission ${response.behavior === 'allow' ? 'approved' : 'denied'} for ${toolName}`
          });
        }

        logger.info('Permission response received', { toolName, response });

        if (response.behavior === 'allow') {
          return {
            behavior: 'allow',
            updatedInput: input
          };
        } else {
          return {
            behavior: 'deny',
            message: response.message || 'Denied by user'
          };
        }
      } catch (error) {
        logger.error('Error in permission handler', error);
        return {
          behavior: 'deny',
          message: 'Error occurred while requesting permission'
        };
      }
    };
  }

  private async waitForApproval(
    approvalId: string,
    signal: AbortSignal
  ): Promise<{ behavior: 'allow' | 'deny'; message?: string }> {
    ensureApprovalDir();
    const approvalFile = path.join(APPROVAL_DIR, `${approvalId}.json`);

    logger.info('Waiting for approval', { approvalId, approvalFile });

    return new Promise((resolve) => {
      const startTime = Date.now();
      const pollInterval = 500; // Check every 500ms
      let pollCount = 0;
      let timeoutId: NodeJS.Timeout;
      let resolved = false;

      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        resolved = true;
      };

      // Handle abort signal
      const abortHandler = () => {
        if (!resolved) {
          cleanup();
          logger.info('Permission request aborted', { approvalId });
          resolve({
            behavior: 'deny',
            message: 'Request was aborted'
          });
        }
      };

      signal.addEventListener('abort', abortHandler);

      const checkApproval = () => {
        if (resolved || signal.aborted) return;

        pollCount++;

        // Check if approval file exists
        if (fs.existsSync(approvalFile)) {
          try {
            const content = fs.readFileSync(approvalFile, 'utf-8');
            logger.info('Found approval file', { approvalId, content });
            const response = JSON.parse(content);

            // Clean up the file
            fs.unlinkSync(approvalFile);

            cleanup();
            signal.removeEventListener('abort', abortHandler);
            logger.info('Received approval response from file', { approvalId, response, pollCount });
            resolve(response);
            return;
          } catch (error) {
            logger.error('Error reading approval file', error);
          }
        }

        // Log every 10 polls (5 seconds)
        if (pollCount % 10 === 0) {
          logger.debug('Still waiting for approval', { approvalId, pollCount, elapsed: Date.now() - startTime });
        }

        // Continue polling
        timeoutId = setTimeout(checkApproval, pollInterval);
      };

      // Start polling
      checkApproval();
    });
  }

  /**
   * Creates a canUseTool callback for auto mode (allow unless dangerous)
   */
  createAutoModeCallback(slackContext: SlackContext, workingDirectory?: string) {
    return async (
      toolName: string,
      input: Record<string, unknown>,
      options: { signal: AbortSignal; suggestions?: any[] }
    ): Promise<PermissionResult> => {
      // Check if operation is safe
      const safetyCheck = checkAutoModeSafety(toolName, input, workingDirectory);

      if (safetyCheck.safe) {
        logger.info('Auto mode: allowing tool', { toolName });
        return {
          behavior: 'allow',
          updatedInput: input
        };
      }

      // Dangerous operation detected - notify and deny
      logger.warn('Auto mode: blocking dangerous operation', {
        toolName,
        reason: safetyCheck.reason
      });

      // Notify user in Slack
      try {
        await this.slack.chat.postMessage({
          channel: slackContext.channel,
          thread_ts: slackContext.threadTs,
          text: `⛔ *Dangerous operation blocked*\n\nTool: \`${toolName}\`\nReason: ${safetyCheck.reason}\n\n*Input:*\n\`\`\`json\n${JSON.stringify(input, null, 2)}\n\`\`\`\n\nSwitch to \`bypass on\` if you want to allow all operations.`
        });
      } catch (error) {
        logger.error('Failed to send block notification', error);
      }

      return {
        behavior: 'deny',
        message: safetyCheck.reason || 'Operation blocked by auto mode'
      };
    };
  }
}

// Export singleton instance
export const permissionHandler = new PermissionHandler();
