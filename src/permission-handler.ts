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
      const timeout = 5 * 60 * 1000; // 5 minutes
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

        // Check if timed out
        if (Date.now() - startTime > timeout) {
          cleanup();
          signal.removeEventListener('abort', abortHandler);
          logger.info('Permission request timed out', { approvalId, pollCount });
          try { fs.unlinkSync(approvalFile); } catch {}
          resolve({
            behavior: 'deny',
            message: 'Permission request timed out'
          });
          return;
        }

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
}

// Export singleton instance
export const permissionHandler = new PermissionHandler();
