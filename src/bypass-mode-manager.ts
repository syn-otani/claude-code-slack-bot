import { Logger } from './logger';

/**
 * Manages bypass mode settings for permission approval.
 * When bypass mode is enabled, tools are executed without requiring user approval.
 */
export class BypassModeManager {
  private bypassModes: Map<string, boolean> = new Map();
  private logger = new Logger('BypassModeManager');

  /**
   * Get the key for storing bypass mode state.
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
   * Set bypass mode for a channel/thread
   */
  setBypassMode(channelId: string, enabled: boolean, threadTs?: string, userId?: string): void {
    const key = this.getKey(channelId, threadTs, userId);
    this.bypassModes.set(key, enabled);
    this.logger.info('Bypass mode changed', { key, enabled });
  }

  /**
   * Get bypass mode for a channel/thread
   * Returns bypass status with priority: Thread > Channel/DM
   */
  isBypassMode(channelId: string, threadTs?: string, userId?: string): boolean {
    // Check thread-specific setting first
    if (threadTs) {
      const threadKey = this.getKey(channelId, threadTs);
      const threadBypass = this.bypassModes.get(threadKey);
      if (threadBypass !== undefined) {
        return threadBypass;
      }
    }

    // Fall back to channel/DM setting
    const channelKey = this.getKey(channelId, undefined, userId);
    return this.bypassModes.get(channelKey) ?? false;
  }

  /**
   * Parse bypass command from text
   * Returns { command: 'on' | 'off' | null } or null if not a bypass command
   */
  parseBypassCommand(text: string): { enable: boolean } | null {
    const trimmed = text.trim().toLowerCase();

    // Match patterns like: "bypass on", "bypass off", "bypass enable", "bypass disable"
    // Also: "approval on", "approval off" (inverted logic)
    const bypassOnMatch = /^bypass\s+(on|enable|enabled|true|1)$/i.test(trimmed);
    const bypassOffMatch = /^bypass\s+(off|disable|disabled|false|0)$/i.test(trimmed);
    const approvalOnMatch = /^approval\s+(on|enable|enabled|true|1)$/i.test(trimmed);
    const approvalOffMatch = /^approval\s+(off|disable|disabled|false|0)$/i.test(trimmed);

    if (bypassOnMatch || approvalOffMatch) {
      return { enable: true };
    }
    if (bypassOffMatch || approvalOnMatch) {
      return { enable: false };
    }

    // Check for status query
    if (/^bypass(\s+status)?(\?)?$/i.test(trimmed) || /^approval(\s+status)?(\?)?$/i.test(trimmed)) {
      return null; // Return null to indicate this is a status query, not a command
    }

    return null;
  }

  /**
   * Check if text is a bypass status query
   */
  isStatusQuery(text: string): boolean {
    const trimmed = text.trim().toLowerCase();
    return /^bypass(\s+status)?(\?)?$/i.test(trimmed) || /^approval(\s+status)?(\?)?$/i.test(trimmed);
  }

  /**
   * Format status message
   */
  formatStatusMessage(enabled: boolean, context: string): string {
    if (enabled) {
      return `🔓 *Bypass mode is ON* for ${context}\n\nTools will be executed without requiring approval.\nUse \`bypass off\` or \`approval on\` to enable approval mode.`;
    } else {
      return `🔐 *Approval mode is ON* for ${context}\n\nYou will be asked to approve tool executions.\nUse \`bypass on\` or \`approval off\` to skip approvals.`;
    }
  }

  /**
   * Get all bypass mode settings (for backup)
   */
  getAllSettings(): Map<string, boolean> {
    return new Map(this.bypassModes);
  }

  /**
   * Restore bypass mode settings from backup
   */
  restoreSettings(settings: Map<string, boolean>): void {
    for (const [key, enabled] of settings.entries()) {
      this.bypassModes.set(key, enabled);
    }
    this.logger.info(`Restored ${settings.size} bypass mode settings`);
  }
}

// Export singleton instance
export const bypassModeManager = new BypassModeManager();
