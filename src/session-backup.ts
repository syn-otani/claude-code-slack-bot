import fs from 'fs';
import path from 'path';
import { Logger } from './logger';
import { ConversationSession } from './types';

export interface SessionBackup {
  sessions: SerializedSession[];
  workingDirectories: Record<string, string>;
  timestamp: string;
  version: number;
}

export interface SerializedSession {
  key: string;
  userId: string;
  channelId: string;
  threadTs?: string;
  sessionId?: string;
  isActive: boolean;
  lastActivity: string;
}

export class SessionBackupManager {
  private logger = new Logger('SessionBackup');
  private backupDir: string;
  private backupFile: string;
  private backupInterval: NodeJS.Timeout | null = null;

  constructor(backupDir?: string) {
    // Default to ~/.claude-code-slack-bot/backups
    this.backupDir = backupDir || path.join(
      process.env.HOME || '/tmp',
      '.claude-code-slack-bot',
      'backups'
    );
    this.backupFile = path.join(this.backupDir, 'sessions.json');
    this.ensureBackupDir();
  }

  private ensureBackupDir(): void {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
      this.logger.info('Created backup directory', { path: this.backupDir });
    }
  }

  /**
   * Save sessions to backup file
   */
  saveBackup(
    sessions: Map<string, ConversationSession>,
    workingDirectories: Map<string, string>
  ): void {
    try {
      const serializedSessions: SerializedSession[] = [];

      for (const [key, session] of sessions.entries()) {
        serializedSessions.push({
          key,
          userId: session.userId,
          channelId: session.channelId,
          threadTs: session.threadTs,
          sessionId: session.sessionId,
          isActive: session.isActive,
          lastActivity: session.lastActivity.toISOString(),
        });
      }

      const backup: SessionBackup = {
        sessions: serializedSessions,
        workingDirectories: Object.fromEntries(workingDirectories),
        timestamp: new Date().toISOString(),
        version: 1,
      };

      // Write to temp file first, then rename (atomic operation)
      const tempFile = `${this.backupFile}.tmp`;
      fs.writeFileSync(tempFile, JSON.stringify(backup, null, 2), 'utf-8');
      fs.renameSync(tempFile, this.backupFile);

      this.logger.info('Session backup saved', {
        sessionCount: serializedSessions.length,
        workingDirCount: workingDirectories.size,
        path: this.backupFile,
      });

      // Also create a timestamped backup every hour (keep last 24)
      this.createTimestampedBackup(backup);
    } catch (error) {
      this.logger.error('Failed to save session backup', error);
    }
  }

  /**
   * Create a timestamped backup file
   */
  private createTimestampedBackup(backup: SessionBackup): void {
    try {
      const now = new Date();
      const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 16);
      const timestampedFile = path.join(this.backupDir, `sessions-${timestamp}.json`);

      // Only create if doesn't exist (avoid duplicates within same minute)
      if (!fs.existsSync(timestampedFile)) {
        fs.writeFileSync(timestampedFile, JSON.stringify(backup, null, 2), 'utf-8');
        this.logger.debug('Created timestamped backup', { path: timestampedFile });

        // Cleanup old backups (keep last 48 = 24 hours at 30min intervals)
        this.cleanupOldBackups(48);
      }
    } catch (error) {
      this.logger.warn('Failed to create timestamped backup', error);
    }
  }

  /**
   * Remove old timestamped backups
   */
  private cleanupOldBackups(keepCount: number): void {
    try {
      const files = fs.readdirSync(this.backupDir)
        .filter(f => f.startsWith('sessions-') && f.endsWith('.json'))
        .sort()
        .reverse();

      if (files.length > keepCount) {
        const toDelete = files.slice(keepCount);
        for (const file of toDelete) {
          fs.unlinkSync(path.join(this.backupDir, file));
          this.logger.debug('Deleted old backup', { file });
        }
      }
    } catch (error) {
      this.logger.warn('Failed to cleanup old backups', error);
    }
  }

  /**
   * Load sessions from backup file
   */
  loadBackup(): SessionBackup | null {
    try {
      if (!fs.existsSync(this.backupFile)) {
        this.logger.info('No backup file found', { path: this.backupFile });
        return null;
      }

      const data = fs.readFileSync(this.backupFile, 'utf-8');
      const backup: SessionBackup = JSON.parse(data);

      this.logger.info('Session backup loaded', {
        sessionCount: backup.sessions.length,
        workingDirCount: Object.keys(backup.workingDirectories).length,
        timestamp: backup.timestamp,
      });

      return backup;
    } catch (error) {
      this.logger.error('Failed to load session backup', error);
      return null;
    }
  }

  /**
   * Restore sessions from backup
   */
  restoreSessions(backup: SessionBackup): {
    sessions: Map<string, ConversationSession>;
    workingDirectories: Map<string, string>;
  } {
    const sessions = new Map<string, ConversationSession>();
    const workingDirectories = new Map<string, string>();

    for (const s of backup.sessions) {
      const session: ConversationSession = {
        userId: s.userId,
        channelId: s.channelId,
        threadTs: s.threadTs,
        sessionId: s.sessionId,
        isActive: s.isActive,
        lastActivity: new Date(s.lastActivity),
      };
      sessions.set(s.key, session);
    }

    for (const [key, dir] of Object.entries(backup.workingDirectories)) {
      workingDirectories.set(key, dir);
    }

    this.logger.info('Sessions restored from backup', {
      sessionCount: sessions.size,
      workingDirCount: workingDirectories.size,
    });

    return { sessions, workingDirectories };
  }

  /**
   * List available backups
   */
  listBackups(): { file: string; timestamp: string; sessionCount: number }[] {
    try {
      const files = fs.readdirSync(this.backupDir)
        .filter(f => f.endsWith('.json'))
        .sort()
        .reverse();

      const backups: { file: string; timestamp: string; sessionCount: number }[] = [];

      for (const file of files.slice(0, 10)) { // Show last 10
        try {
          const data = fs.readFileSync(path.join(this.backupDir, file), 'utf-8');
          const backup: SessionBackup = JSON.parse(data);
          backups.push({
            file,
            timestamp: backup.timestamp,
            sessionCount: backup.sessions.length,
          });
        } catch {
          // Skip invalid files
        }
      }

      return backups;
    } catch (error) {
      this.logger.error('Failed to list backups', error);
      return [];
    }
  }

  /**
   * Start periodic backup
   */
  startPeriodicBackup(
    getSessions: () => Map<string, ConversationSession>,
    getWorkingDirectories: () => Map<string, string>,
    intervalMinutes: number = 30
  ): void {
    if (this.backupInterval) {
      clearInterval(this.backupInterval);
    }

    // Save immediately on start
    this.saveBackup(getSessions(), getWorkingDirectories());

    // Then save periodically
    this.backupInterval = setInterval(() => {
      this.logger.debug('Running periodic session backup');
      this.saveBackup(getSessions(), getWorkingDirectories());
    }, intervalMinutes * 60 * 1000);

    this.logger.info('Periodic backup started', { intervalMinutes });
  }

  /**
   * Stop periodic backup
   */
  stopPeriodicBackup(): void {
    if (this.backupInterval) {
      clearInterval(this.backupInterval);
      this.backupInterval = null;
      this.logger.info('Periodic backup stopped');
    }
  }

  /**
   * Get backup directory path
   */
  getBackupDir(): string {
    return this.backupDir;
  }
}
