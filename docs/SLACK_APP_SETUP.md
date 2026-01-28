# Slack App 設定ガイド（詳細版）

このドキュメントでは、Claude Code Slack Botを動作させるためのSlackアプリの設定手順を解説します。

> **画像について**: `docs/images/` ディレクトリにスクリーンショットを配置すると、より分かりやすくなります。

## 目次
1. [アプリの作成](#1-アプリの作成)
2. [Socket Modeの有効化](#2-socket-modeの有効化)
3. [App-Level Tokenの生成](#3-app-level-tokenの生成)
4. [Bot Token Scopesの設定](#4-bot-token-scopesの設定)
5. [Event Subscriptionsの設定](#5-event-subscriptionsの設定)
6. [App Homeの設定](#6-app-homeの設定-最重要)
7. [アプリのインストール](#7-アプリのインストール)
8. [トークンの取得](#8-トークンの取得)
9. [トラブルシューティング](#9-トラブルシューティング)

---

## 1. アプリの作成

1. [Slack API](https://api.slack.com/apps) にアクセス
2. 右上の「**Create New App**」ボタンをクリック
3. 「**From scratch**」を選択
4. 以下を入力:
   - **App Name**: 任意の名前（例: `Claude Code Bot`）
   - **Pick a workspace**: ボットを追加するワークスペース

```
┌─────────────────────────────────────┐
│  Create an app                      │
│                                     │
│  ○ From scratch                     │  ← これを選択
│  ○ From an app manifest             │
│                                     │
└─────────────────────────────────────┘
```

---

## 2. Socket Modeの有効化

**重要**: Socket Modeを使用することで、パブリックなURLを公開せずにボットを動作させることができます。

1. 左メニューの「**Socket Mode**」をクリック
2. 「**Enable Socket Mode**」のトグルを **ON** にする

```
┌─────────────────────────────────────┐
│ Settings                            │
│ ├─ Basic Information                │
│ ├─ Collaborators                    │
│ ├─ Socket Mode        ← ここ        │
│ ├─ Install App                      │
│ ...                                 │
└─────────────────────────────────────┘

Enable Socket Mode:  [====ON====]
```

---

## 3. App-Level Tokenの生成

Socket Modeを有効にすると、App-Level Tokenの生成を求められます。

1. 「**Token Name**」を入力（例: `socket-token`）
2. 「**Add Scope**」をクリック
3. 「**connections:write**」を選択
4. 「**Generate**」ボタンをクリック
5. **生成された `xapp-` で始まるトークンをコピー** → `.env` の `SLACK_APP_TOKEN` に設定

```
┌─────────────────────────────────────────────────┐
│ App-Level Tokens                                │
│                                                 │
│ Token Name: socket-token                        │
│                                                 │
│ Scopes:                                         │
│ ┌─────────────────────────────┐                │
│ │ connections:write           │                │
│ └─────────────────────────────┘                │
│                                                 │
│ Token: xapp-1-XXXXX-XXXXX-XXXXXXXXXX           │
│        ↑ これをコピー                           │
└─────────────────────────────────────────────────┘
```

---

## 4. Bot Token Scopesの設定

1. 左メニューの「**OAuth & Permissions**」をクリック
2. ページを下にスクロールして「**Scopes**」セクションを見つける
3. 「**Bot Token Scopes**」で「**Add an OAuth Scope**」をクリック
4. 以下のスコープを**すべて**追加:

| スコープ | 説明 | 必須 |
|---------|------|:----:|
| `app_mentions:read` | メンションを受け取る | ✅ |
| `channels:history` | パブリックチャンネルのメッセージを読む | ✅ |
| `chat:write` | メッセージを送信する | ✅ |
| `im:history` | DMのメッセージを読む | ✅ |
| `im:read` | DMの基本情報を取得 | ✅ |
| `im:write` | DMを開始する | ✅ |
| `reactions:read` | リアクションを読む | ✅ |
| `reactions:write` | リアクションを追加する | ✅ |

```
┌─────────────────────────────────────────────────┐
│ Scopes                                          │
│                                                 │
│ Bot Token Scopes                            ▼  │
│ ┌─────────────────────────────────────────────┐│
│ │ app_mentions:read                     🗑️   ││
│ │ channels:history                      🗑️   ││
│ │ chat:write                            🗑️   ││
│ │ im:history                            🗑️   ││
│ │ im:read                               🗑️   ││
│ │ im:write                              🗑️   ││
│ │ reactions:read                        🗑️   ││
│ │ reactions:write                       🗑️   ││
│ └─────────────────────────────────────────────┘│
│ [Add an OAuth Scope]                            │
└─────────────────────────────────────────────────┘
```

---

## 5. Event Subscriptionsの設定

1. 左メニューの「**Event Subscriptions**」をクリック
2. 「**Enable Events**」のトグルを **ON** にする
3. 「**Subscribe to bot events**」セクションを展開
4. 「**Add Bot User Event**」をクリックして以下を追加:

| イベント | 説明 | 必須 |
|---------|------|:----:|
| `app_mention` | ボットがメンションされた時 | ✅ |
| `message.im` | DMでメッセージを受信した時 | ✅ |

```
┌─────────────────────────────────────────────────┐
│ Enable Events:  [====ON====]                    │
│                                                 │
│ ┌─────────────────────────────────────────────┐│
│ │ Socket Mode is enabled. You won't need to  ││
│ │ specify a Request URL.                      ││
│ └─────────────────────────────────────────────┘│
│                                                 │
│ Subscribe to bot events                      ▼ │
│ ┌─────────────────────────────────────────────┐│
│ │ Event Name      │ Description    │ Scope   ││
│ │─────────────────┼────────────────┼─────────││
│ │ app_mention     │ Subscribe to...│ app_... ││
│ │ message.im      │ A message was..│ im:hist ││
│ └─────────────────────────────────────────────┘│
│ [Add Bot User Event]                            │
└─────────────────────────────────────────────────┘
```

**注意**: Socket Modeが有効な場合、「Request URL」の設定は不要です。

---

## 6. App Homeの設定（最重要）

### ⚠️ この設定を忘れると、DMでボットにメッセージを送れません！

1. 左メニューの「**App Home**」をクリック
2. 「**Show Tabs**」セクションを見つける
3. 以下を設定:
   - **Home Tab**: ON（任意）
   - **Messages Tab**: **ON**（必須）
   - ☑️ **Allow users to send Slash commands and messages from the messages tab**（必須）

```
┌─────────────────────────────────────────────────┐
│ Show Tabs                                       │
│                                                 │
│ Home Tab                          [====ON====] │
│ Block Kit components you add...                 │
│                                                 │
│ Messages Tab                      [====ON====] │  ← 必ずON
│ Direct messages your app sends...               │
│                                                 │
│ ☑️ Allow users to send Slash commands and      │  ← 必ずチェック
│    messages from the messages tab               │
│                                                 │
└─────────────────────────────────────────────────┘
```

### よくあるエラー

この設定が正しく行われていない場合、Slackで以下のエラーが表示されます:

```
┌─────────────────────────────────────────────────┐
│ ⚠️ Slack couldn't send this message            │
│                                                 │
│ Sending messages to this app has been          │
│ turned off.                                     │
└─────────────────────────────────────────────────┘
```

**解決策**: 上記の設定を確認し、アプリを再インストールしてください。

---

## 7. アプリのインストール

1. 左メニューの「**Install App**」をクリック
2. 「**Install to Workspace**」ボタンをクリック
3. 権限を確認して「**許可する**」をクリック

```
┌─────────────────────────────────────────────────┐
│ Install App                                     │
│                                                 │
│ [Install to Workspace]                          │
│                                                 │
│ ※設定を変更した場合は                           │
│   [Reinstall to Workspace] をクリック           │
└─────────────────────────────────────────────────┘
```

**重要**: スコープやイベントを追加・変更した場合は、必ず「**Reinstall to Workspace**」で再インストールしてください。

---

## 8. トークンの取得

### 8.1 Bot User OAuth Token

1. 左メニューの「**OAuth & Permissions**」をクリック
2. 「**OAuth Tokens for Your Workspace**」セクションを見つける
3. **`xoxb-` で始まるトークンをコピー** → `.env` の `SLACK_BOT_TOKEN` に設定

```
┌─────────────────────────────────────────────────┐
│ OAuth Tokens for Your Workspace                 │
│                                                 │
│ Bot User OAuth Token                            │
│ xoxb-1234567890-1234567890123-XXXXXXXXXX       │
│ ↑ これをコピー                                  │
│ [Copy]                                          │
└─────────────────────────────────────────────────┘
```

### 8.2 Signing Secret

1. 左メニューの「**Basic Information**」をクリック
2. 「**App Credentials**」セクションを見つける
3. 「**Signing Secret**」の「**Show**」をクリック
4. **シークレットをコピー** → `.env` の `SLACK_SIGNING_SECRET` に設定

```
┌─────────────────────────────────────────────────┐
│ App Credentials                                 │
│                                                 │
│ Signing Secret                                  │
│ ●●●●●●●●●●●●●●●●  [Show]                       │
│                    ↑ クリックして表示            │
└─────────────────────────────────────────────────┘
```

---

## 9. トラブルシューティング

### 9.1 DMでメッセージが送れない

**症状**: 「Sending messages to this app has been turned off」と表示される

**解決策**:
1. App Home → Messages Tab を **ON**
2. 「Allow users to send Slash commands and messages from the messages tab」に**チェック**
3. アプリを**再インストール**（Reinstall to Workspace）
4. Slackアプリを再起動、または会話を閉じて再度開く

### 9.2 ボットが応答しない

**確認項目**:
1. ボットプロセスは起動しているか？
   ```bash
   npm run dev
   # ログに「⚡️ Claude Code Slack bot is running!」が表示されるか確認
   ```
2. Socket Modeは有効か？
3. Event Subscriptionsで `message.im` と `app_mention` が設定されているか？
4. トークンは正しいか？
   - `xapp-` → `SLACK_APP_TOKEN`
   - `xoxb-` → `SLACK_BOT_TOKEN`

### 9.3 「OAuth token has expired」エラー

1. Install App ページでアプリを**再インストール**
2. 新しい Bot Token を `.env` に設定

### 9.4 複数PCで同じボットを使いたい

同じトークンで複数のプロセスを起動すると**競合**します。

**解決策**: 開発用と本番用で**別のSlackアプリを作成**してください。

---

## 設定チェックリスト

設定が完了したら、以下を確認してください:

- [ ] **Socket Mode**: ON
- [ ] **App-Level Token** (`xapp-`): 生成済み、`.env`に設定
- [ ] **Bot Token Scopes**: 8個すべて追加
  - [ ] `app_mentions:read`
  - [ ] `channels:history`
  - [ ] `chat:write`
  - [ ] `im:history`
  - [ ] `im:read`
  - [ ] `im:write`
  - [ ] `reactions:read`
  - [ ] `reactions:write`
- [ ] **Event Subscriptions**: 2個追加
  - [ ] `app_mention`
  - [ ] `message.im`
- [ ] **App Home**:
  - [ ] Messages Tab: ON
  - [ ] メッセージ送信許可: チェック済み
- [ ] アプリをワークスペースに**インストール**
- [ ] **Bot Token** (`xoxb-`): コピー済み、`.env`に設定
- [ ] **Signing Secret**: コピー済み、`.env`に設定

---

## .envファイルの例

```env
SLACK_BOT_TOKEN=xoxb-xxxxxxxxxxxx-xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxx
SLACK_APP_TOKEN=xapp-x-xxxxxxxxxxx-xxxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SLACK_SIGNING_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SESSION_TIMEOUT_HOURS=0
```

---

## 次のステップ

設定が完了したら、ボットを起動します:

```bash
cd ~/claude-code-slack-bot
npm run dev
```

自動起動を設定する場合は、`INSTALL_JP.md` の「launchd設定」セクションを参照してください。
