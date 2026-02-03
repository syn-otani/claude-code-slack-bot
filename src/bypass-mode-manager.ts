import { Logger } from './logger';

export type PermissionMode = 'approval' | 'bypass' | 'auto';

/**
 * Manages permission mode settings.
 * - approval: All tool executions require user approval
 * - bypass: All tool executions are allowed without approval
 * - auto: Tool executions are allowed without approval, except dangerous operations
 */
export class BypassModeManager {
  private modes: Map<string, PermissionMode> = new Map();
  private logger = new Logger('BypassModeManager');

  /**
   * Get the key for storing mode state.
   * Uses the same key format as working directory manager.
   */
  private getKey(channelId: string, threadTs?: string, userId?: string): string {
    if (threadTs) {
      return `${channelId}-${threadTs}`;
    }
    if (userId && channelId.startsWith('D')) {
      return `${channelId}-${userId}`;
    }
    return channelId;
  }

  /**
   * Set permission mode for a channel/thread
   */
  setMode(channelId: string, mode: PermissionMode, threadTs?: string, userId?: string): void {
    const key = this.getKey(channelId, threadTs, userId);
    this.modes.set(key, mode);
    this.logger.info('Permission mode changed', { key, mode });
  }

  /**
   * Get permission mode for a channel/thread
   * Returns mode with priority: Thread > Channel/DM
   * Default: 'approval'
   */
  getMode(channelId: string, threadTs?: string, userId?: string): PermissionMode {
    // Check thread-specific setting first
    if (threadTs) {
      const threadKey = this.getKey(channelId, threadTs);
      const threadMode = this.modes.get(threadKey);
      if (threadMode !== undefined) {
        return threadMode;
      }
    }

    // Fall back to channel/DM setting
    const channelKey = this.getKey(channelId, undefined, userId);
    return this.modes.get(channelKey) ?? 'approval';
  }

  // Legacy compatibility methods
  setBypassMode(channelId: string, enabled: boolean, threadTs?: string, userId?: string): void {
    this.setMode(channelId, enabled ? 'bypass' : 'approval', threadTs, userId);
  }

  isBypassMode(channelId: string, threadTs?: string, userId?: string): boolean {
    return this.getMode(channelId, threadTs, userId) === 'bypass';
  }

  isAutoMode(channelId: string, threadTs?: string, userId?: string): boolean {
    return this.getMode(channelId, threadTs, userId) === 'auto';
  }

  isApprovalMode(channelId: string, threadTs?: string, userId?: string): boolean {
    return this.getMode(channelId, threadTs, userId) === 'approval';
  }

  /**
   * Parse mode command from text
   * Returns mode or null if not a mode command
   */
  parseModeCommand(text: string): { mode: PermissionMode } | null {
    const trimmed = text.trim().toLowerCase();

    // Auto mode
    if (/^auto\s+(on|enable|enabled|true|1)$/i.test(trimmed)) {
      return { mode: 'auto' };
    }
    if (/^auto\s+(off|disable|disabled|false|0)$/i.test(trimmed)) {
      return { mode: 'approval' };
    }

    // Bypass mode (legacy)
    if (/^bypass\s+(on|enable|enabled|true|1)$/i.test(trimmed)) {
      return { mode: 'bypass' };
    }
    if (/^bypass\s+(off|disable|disabled|false|0)$/i.test(trimmed)) {
      return { mode: 'approval' };
    }

    // Approval mode
    if (/^approval\s+(on|enable|enabled|true|1)$/i.test(trimmed)) {
      return { mode: 'approval' };
    }
    if (/^approval\s+(off|disable|disabled|false|0)$/i.test(trimmed)) {
      return { mode: 'bypass' };
    }

    return null;
  }

  // Legacy method for compatibility
  parseBypassCommand(text: string): { enable: boolean } | null {
    const result = this.parseModeCommand(text);
    if (result) {
      return { enable: result.mode === 'bypass' };
    }
    return null;
  }

  /**
   * Check if text is a mode status query
   */
  isStatusQuery(text: string): boolean {
    const trimmed = text.trim().toLowerCase();
    return /^(mode|bypass|approval|auto)(\s+status)?(\?)?$/i.test(trimmed);
  }

  /**
   * Format status message
   */
  formatStatusMessage(mode: PermissionMode, context: string): string {
    switch (mode) {
      case 'bypass':
        return `🔓 *Bypass mode* for ${context}\n\nAll tools executed without approval.\nUse \`approval on\` or \`auto on\` to change.`;
      case 'auto':
        return `🤖 *Auto mode* for ${context}\n\nTools executed automatically, dangerous operations blocked.\nUse \`approval on\` or \`bypass on\` to change.`;
      case 'approval':
      default:
        return `🔐 *Approval mode* for ${context}\n\nAll tool executions require approval.\nUse \`auto on\` or \`bypass on\` to change.`;
    }
  }

  /**
   * Get all mode settings (for backup)
   */
  getAllSettings(): Map<string, PermissionMode> {
    return new Map(this.modes);
  }

  /**
   * Restore mode settings from backup
   */
  restoreSettings(settings: Map<string, PermissionMode | boolean>): void {
    for (const [key, value] of settings.entries()) {
      // Handle legacy boolean format
      if (typeof value === 'boolean') {
        this.modes.set(key, value ? 'bypass' : 'approval');
      } else {
        this.modes.set(key, value);
      }
    }
    this.logger.info(`Restored ${settings.size} mode settings`);
  }
}

// Export singleton instance
export const bypassModeManager = new BypassModeManager();
