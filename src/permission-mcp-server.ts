#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { WebClient } from '@slack/web-api';
import { Logger } from './logger.js';
import * as fs from 'fs';
import * as path from 'path';

const logger = new Logger('PermissionMCP');

// Directory for approval communication files
const APPROVAL_DIR = path.join(process.env.HOME || '/tmp', '.claude-code-slack-bot', 'approvals');

interface PermissionRequest {
  tool_name: string;
  input: any;
  channel?: string;
  thread_ts?: string;
  user?: string;
}

interface PermissionResponse {
  behavior: 'allow' | 'deny';
  updatedInput?: any;
  message?: string;
}

// Ensure approval directory exists
function ensureApprovalDir() {
  if (!fs.existsSync(APPROVAL_DIR)) {
    fs.mkdirSync(APPROVAL_DIR, { recursive: true });
  }
}

class PermissionMCPServer {
  private server: Server;
  private slack: WebClient;
  private pendingApprovals = new Map<string, {
    resolve: (response: PermissionResponse) => void;
    reject: (error: Error) => void;
  }>();

  constructor() {
    this.server = new Server(
      {
        name: "permission-prompt",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.slack = new WebClient(process.env.SLACK_BOT_TOKEN);
    this.setupHandlers();
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "permission_prompt",
            description: "Request user permission for tool execution via Slack button",
            inputSchema: {
              type: "object",
              properties: {
                tool_name: {
                  type: "string",
                  description: "Name of the tool requesting permission",
                },
                input: {
                  type: "object",
                  description: "Input parameters for the tool",
                },
                channel: {
                  type: "string",
                  description: "Slack channel ID",
                },
                thread_ts: {
                  type: "string",
                  description: "Slack thread timestamp",
                },
                user: {
                  type: "string",
                  description: "User ID requesting permission",
                },
              },
              required: ["tool_name", "input"],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name === "permission_prompt") {
        return await this.handlePermissionPrompt(request.params.arguments as PermissionRequest);
      }
      throw new Error(`Unknown tool: ${request.params.name}`);
    });
  }

  private async handlePermissionPrompt(params: PermissionRequest) {
    const { tool_name, input } = params;
    
    // Get Slack context from environment (passed by Claude handler)
    const slackContextStr = process.env.SLACK_CONTEXT;
    const slackContext = slackContextStr ? JSON.parse(slackContextStr) : {};
    const { channel, threadTs: thread_ts, user } = slackContext;
    
    // Generate unique approval ID
    const approvalId = `approval_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Create approval message with buttons (with user mention)
    const mentionText = user ? `<@${user}> ` : '';
    const blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${mentionText}🔐 *Permission Request*\n\nClaude wants to use the tool: \`${tool_name}\`\n\n*Tool Parameters:*\n\`\`\`json\n${JSON.stringify(input, null, 2)}\n\`\`\``
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
            text: `Requested by: <@${user}> | Tool: ${tool_name}`
          }
        ]
      }
    ];

    try {
      // Send approval request to Slack (with mention in fallback text for notification)
      const result = await this.slack.chat.postMessage({
        channel: channel || user || 'general',
        thread_ts: thread_ts,
        blocks,
        text: `${mentionText}Permission request for ${tool_name}` // Fallback text with mention
      });

      // Wait for user response
      const response = await this.waitForApproval(approvalId);
      
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
                text: `🔐 *Permission Request* - ${response.behavior === 'allow' ? '✅ Approved' : '❌ Denied'}\n\nTool: \`${tool_name}\`\n\n*Tool Parameters:*\n\`\`\`json\n${JSON.stringify(input, null, 2)}\n\`\`\``
              }
            },
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: `${response.behavior === 'allow' ? 'Approved' : 'Denied'} by user | Tool: ${tool_name}`
                }
              ]
            }
          ],
          text: `Permission ${response.behavior === 'allow' ? 'approved' : 'denied'} for ${tool_name}`
        });
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response)
          }
        ]
      };
    } catch (error) {
      logger.error('Error handling permission prompt:', error);
      
      // Default to deny if there's an error
      const response: PermissionResponse = {
        behavior: 'deny',
        message: 'Error occurred while requesting permission'
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response)
          }
        ]
      };
    }
  }

  private async waitForApproval(approvalId: string): Promise<PermissionResponse> {
    ensureApprovalDir();
    const approvalFile = path.join(APPROVAL_DIR, `${approvalId}.json`);

    logger.info('Waiting for approval', {
      approvalId,
      approvalFile,
      approvalDir: APPROVAL_DIR,
      home: process.env.HOME
    });

    return new Promise((resolve) => {
      const startTime = Date.now();
      const timeout = 5 * 60 * 1000; // 5 minutes
      const pollInterval = 500; // Check every 500ms
      let pollCount = 0;

      const checkApproval = () => {
        pollCount++;

        // Check if timed out
        if (Date.now() - startTime > timeout) {
          logger.info('Permission request timed out', { approvalId, pollCount });
          // Clean up any leftover file
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
            const response = JSON.parse(content) as PermissionResponse;

            // Clean up the file
            fs.unlinkSync(approvalFile);

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
        setTimeout(checkApproval, pollInterval);
      };

      // Start polling
      checkApproval();
    });
  }

  // Method to be called by Slack handler when button is clicked
  public resolveApproval(approvalId: string, approved: boolean, updatedInput?: any) {
    const pending = this.pendingApprovals.get(approvalId);
    if (pending) {
      this.pendingApprovals.delete(approvalId);
      pending.resolve({
        behavior: approved ? 'allow' : 'deny',
        updatedInput: updatedInput || undefined,
        message: approved ? 'Approved by user' : 'Denied by user'
      });
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    logger.info('Permission MCP server started');
  }
}

// Export singleton instance for use by Slack handler
export const permissionServer = new PermissionMCPServer();

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  permissionServer.run().catch((error) => {
    logger.error('Permission MCP server error:', error);
    process.exit(1);
  });
}