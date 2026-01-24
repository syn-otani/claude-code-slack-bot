# Claude Code Slack Bot インストールマニュアル（macOS）

SlackからClaude Codeを使用できるボットのセットアップガイドです。

## 前提条件

### 必須要件
- macOS
- Node.js 18以上
- Claude Code CLI（インストール済み＆ログイン済み）
- Claude MAXプラン（またはAnthropic API Key）

### 事前確認
```bash
# Node.jsバージョン確認
node -v  # v18以上であること

# Claude Code確認
claude --version
claude whoami  # ログイン済みであること
```

もしClaude Codeにログインしていない場合:
```bash
claude /login
```

---

## Step 1: Slack Appの作成

### 1.1 アプリの作成
1. https://api.slack.com/apps にアクセス
2. 「Create New App」をクリック
3. 「From scratch」を選択
4. App Name: `Claude Code Bot`（任意の名前）
5. ワークスペースを選択して作成

### 1.2 Socket Modeの有効化
1. 左メニュー「Socket Mode」をクリック
2. 「Enable Socket Mode」をON
3. App-Level Token名を入力（例: `socket-token`）
4. Scopeに `connections:write` を追加
5. 「Generate」をクリック
6. 生成された `xapp-` で始まるトークンをメモ

### 1.3 Bot Token Scopesの設定
1. 左メニュー「OAuth & Permissions」をクリック
2. 「Bot Token Scopes」セクションで以下を追加:
   - `app_mentions:read`
   - `channels:history`
   - `chat:write`
   - `im:history`
   - `im:read`
   - `im:write`
   - `reactions:read`
   - `reactions:write`

### 1.4 Event Subscriptionsの設定
1. 左メニュー「Event Subscriptions」をクリック
2. 「Enable Events」をON
3. 「Subscribe to bot events」で以下を追加:
   - `app_mention`
   - `message.im`

### 1.5 App Homeの設定
1. 左メニュー「App Home」をクリック
2. 「Show Tabs」セクション:
   - 「Messages Tab」をON
   - 「Allow users to send Slash commands and messages from the messages tab」にチェック

### 1.6 アプリのインストール
1. 左メニュー「OAuth & Permissions」をクリック
2. 「Install to Workspace」をクリック
3. 権限を許可
4. 生成された `xoxb-` で始まるBot User OAuth Tokenをメモ

### 1.7 Signing Secretの取得
1. 左メニュー「Basic Information」をクリック
2. 「App Credentials」セクションの「Signing Secret」をメモ

---

## Step 2: ボットのセットアップ

### 2.1 リポジトリのクローン
```bash
cd ~
git clone https://github.com/mpociot/claude-code-slack-bot.git
cd claude-code-slack-bot
```

### 2.2 セットアップスクリプトの実行
```bash
./scripts/setup.sh
```

スクリプトが以下を確認・実行します:
- Node.jsバージョンの確認
- Claude Code CLIの確認
- npm依存関係のインストール
- Claude Code SDKの更新
- Slackトークンの入力（対話式）
- バックアップディレクトリの作成
- launchd設定の作成
- サービスの起動

### 2.3 手動セットアップ（スクリプトを使わない場合）

#### 依存関係のインストール
```bash
npm install
npm update @anthropic-ai/claude-code
```

#### .envファイルの作成
```bash
cat > .env << EOF
SLACK_BOT_TOKEN=xoxb-your-token-here
SLACK_APP_TOKEN=xapp-your-token-here
SLACK_SIGNING_SECRET=your-signing-secret-here
# セッションタイムアウト（時間単位、0=無期限）
SESSION_TIMEOUT_HOURS=0
EOF
```

#### バックアップディレクトリの作成
```bash
mkdir -p ~/.claude-code-slack-bot/backups
```

#### 動作テスト
```bash
npm run dev
```
正常に起動したらCtrl+Cで停止。

#### launchd設定ファイルの作成
`~/Library/LaunchAgents/com.claude-code-slack-bot.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.claude-code-slack-bot</string>

    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/node</string>
        <string>/Users/YOUR_USERNAME/claude-code-slack-bot/node_modules/.bin/tsx</string>
        <string>/Users/YOUR_USERNAME/claude-code-slack-bot/src/index.ts</string>
    </array>

    <key>WorkingDirectory</key>
    <string>/Users/YOUR_USERNAME/claude-code-slack-bot</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>/Users/YOUR_USERNAME</string>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>SLACK_BOT_TOKEN</key>
        <string>xoxb-your-token</string>
        <key>SLACK_APP_TOKEN</key>
        <string>xapp-your-token</string>
        <key>SLACK_SIGNING_SECRET</key>
        <string>your-secret</string>
        <key>SESSION_TIMEOUT_HOURS</key>
        <string>0</string>
    </dict>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>/tmp/claude-code-slack-bot.log</string>

    <key>StandardErrorPath</key>
    <string>/tmp/claude-code-slack-bot.error.log</string>
</dict>
</plist>
```

※ `YOUR_USERNAME` を自分のユーザー名に置き換えてください。

#### サービスの起動
```bash
launchctl load ~/Library/LaunchAgents/com.claude-code-slack-bot.plist
```

---

## Step 3: 動作確認

### ステータス確認
```bash
launchctl list | grep claude-code-slack-bot
```
出力例: `12345  0  com.claude-code-slack-bot`
- 2番目の数字が `0` なら正常動作
- `-` や `0以外` ならエラー

### ログ確認
```bash
# 標準出力
tail -f /tmp/claude-code-slack-bot.log

# エラー出力
tail -f /tmp/claude-code-slack-bot.error.log
```

---

## 使い方

### Slackでの基本操作

1. **ボットにDMを送信**またはチャンネルで**@メンション**

2. **作業ディレクトリを設定**:
   ```
   cwd /path/to/your/project
   ```

3. **質問やタスクを依頼**:
   ```
   このプロジェクトの構造を教えて
   ```
   ```
   READMEを作成して
   ```

### スレッドでの会話
- 同じスレッド内では会話のコンテキストが維持されます
- 新しいスレッドを開始すると、新しいセッションになります

---

## セッション管理

### 自動バックアップ
- セッションは**30分ごと**に自動バックアップされます
- サービス停止時にもバックアップが保存されます
- バックアップ先: `~/.claude-code-slack-bot/backups/`

### セッションの永続化
- `SESSION_TIMEOUT_HOURS=0` でセッションが無期限になります
- サービスを再起動してもセッションが復元されます

### Slackセッションをターミナルで続ける

Slackで行っていた会話をターミナルで続けることができます。

#### 方法1: スクリプトを使用
```bash
# セッション一覧を表示
~/claude-code-slack-bot/scripts/resume-session.sh

# 最新のセッションを再開
~/claude-code-slack-bot/scripts/resume-session.sh --latest

# 特定のセッションを再開
~/claude-code-slack-bot/scripts/resume-session.sh <session-id>
```

#### 方法2: 直接コマンド
```bash
# バックアップからセッションIDを確認
cat ~/.claude-code-slack-bot/backups/sessions.json | grep sessionId

# セッションを再開
cd /path/to/working/directory
claude --resume <session-id>
```

### ターミナルからSlackへ
ターミナルで作業した後、Slackの同じスレッドで会話を続けることもできます。セッションIDが同じであれば、会話は継続されます。

---

## 運用コマンド

```bash
# サービス起動
launchctl load ~/Library/LaunchAgents/com.claude-code-slack-bot.plist

# サービス停止
launchctl unload ~/Library/LaunchAgents/com.claude-code-slack-bot.plist

# サービス再起動
launchctl unload ~/Library/LaunchAgents/com.claude-code-slack-bot.plist && \
launchctl load ~/Library/LaunchAgents/com.claude-code-slack-bot.plist

# ステータス確認
launchctl list | grep claude-code-slack-bot

# ログ監視
tail -f /tmp/claude-code-slack-bot.log

# バックアップ確認
cat ~/.claude-code-slack-bot/backups/sessions.json
```

---

## トラブルシューティング

### 「Sending messages to this app has been turned off」
- Slack App設定 → App Home → Messages TabをON
- 「Allow users to send Slash commands...」にチェック

### 「invalid_auth」エラー
- トークンが正しいか確認
- Slack Appを再インストール
- plistファイルのトークンを更新してサービス再起動

### 「Claude Code process exited with code 1」
- Claude Codeにログインしているか確認: `claude whoami`
- ログインしていなければ: `claude /login`
- plistにHOME環境変数が設定されているか確認
- サービスを再起動

### 「OAuth token has expired」
- ターミナルで `claude` を実行してセッションを更新
- サービスを再起動

### 「Socket Mode is not turned on」
- Slack App設定 → Socket Mode → Enable Socket ModeをON

### セッションが復元されない
- バックアップファイルが存在するか確認: `ls ~/.claude-code-slack-bot/backups/`
- ログでエラーを確認: `grep -i "backup\|restore" /tmp/claude-code-slack-bot.log`

---

## アンインストール

```bash
./scripts/uninstall.sh
```

または手動で:
```bash
# サービス停止
launchctl unload ~/Library/LaunchAgents/com.claude-code-slack-bot.plist

# 設定ファイル削除
rm ~/Library/LaunchAgents/com.claude-code-slack-bot.plist

# ログ削除
rm /tmp/claude-code-slack-bot.log
rm /tmp/claude-code-slack-bot.error.log

# バックアップ削除（任意）
rm -rf ~/.claude-code-slack-bot

# アプリケーション削除（任意）
rm -rf ~/claude-code-slack-bot
```

---

## ファイル構成

```
~/claude-code-slack-bot/
├── .env                    # 環境変数（Slackトークン）
├── src/
│   ├── index.ts           # エントリーポイント
│   ├── claude-handler.ts  # Claude Code SDK連携
│   ├── slack-handler.ts   # Slackイベント処理
│   ├── session-backup.ts  # セッションバックアップ機能
│   └── ...
├── scripts/
│   ├── setup.sh           # セットアップスクリプト
│   ├── uninstall.sh       # アンインストールスクリプト
│   └── resume-session.sh  # セッション再開スクリプト
└── package.json

~/.claude-code-slack-bot/
└── backups/
    ├── sessions.json              # 最新のバックアップ
    └── sessions-YYYY-MM-DDTHH-MM.json  # タイムスタンプ付きバックアップ

~/Library/LaunchAgents/
└── com.claude-code-slack-bot.plist  # launchd設定

/tmp/
├── claude-code-slack-bot.log        # 標準出力ログ
└── claude-code-slack-bot.error.log  # エラーログ
```

---

## 環境変数

| 変数名 | 必須 | 説明 |
|--------|------|------|
| `SLACK_BOT_TOKEN` | Yes | Bot User OAuth Token (xoxb-...) |
| `SLACK_APP_TOKEN` | Yes | App-Level Token (xapp-...) |
| `SLACK_SIGNING_SECRET` | Yes | Signing Secret |
| `SESSION_TIMEOUT_HOURS` | No | セッションタイムアウト時間（デフォルト: 24、0=無期限） |
| `BASE_DIRECTORY` | No | 相対パスの基準ディレクトリ |
| `DEBUG` | No | デバッグモード（true/false） |

---

## 注意事項

- このボットはローカルマシンで動作し、Claude Code CLIを使用します
- Claude MAXプランまたはAnthropic API Keyが必要です
- ボットが動作しているマシンがオンラインである必要があります
- セキュリティ上、Slackトークンは適切に管理してください
- セッションバックアップには会話履歴は含まれません（セッションIDのみ）
