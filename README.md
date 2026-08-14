# dsh-jingle

在 dsh（DeepSeek Harness）事件上播放提示音，灵感来自 [pi-jingle](https://github.com/Git-Monke/pi-jingle)。配置键直接使用 dsh 的原生事件名（`agent/status/idle`、`turn/end`、`tool/call`……），不做二次命名。

Play sounds on dsh events — inspired by [pi-jingle](https://github.com/Git-Monke/pi-jingle), configured with native dsh event names.

## 安装 / Install

把插件装进你的 profile（以 `web` profile 为例）：

```bash
cd ~/.dsh/profiles/web
pnpm add -w git+https://github.com/rxh1999/dsh-jingle.git
```

在 `~/.dsh/profiles/web/cordis.patch.yml` 中加入：

```yaml
- insert:
    - id: jingle
      name: dsh-jingle
```

重启 dsh（`dsh web`）生效。**默认完全静默**——不配置任何声音就不会播放，配置见下。

Install the plugin into your profile, add the patch row, restart `dsh web`. The plugin is silent until you configure sounds.

也可以跳过手动配置：直接在对话里告诉 LLM 要什么提示音，agent 会帮你配置好，例如：

> 帮我配置 dsh-jingle：任务完成时播放提示音

Or skip manual configuration: just tell the LLM in the conversation what sounds you want — the agent configures it for you, for example:

> Configure dsh-jingle to play a chime when a task finishes.

## 配置 / Configuration

在用户设置文档 `$DSH_HOME/settings.yaml`（默认 `~/.dsh/settings.yaml`）中新增 `sounds:` 段，**保存即热重载**，无需重启：

Add a `sounds:` section to your settings document — it hot-reloads on save:

```yaml
sounds:
  agent/status/idle: ./sounds/done.wav                 # 任务完成时播放
  turn/end: { path: ./sounds/chime.wav, volume: 0.4 }  # 对象形式可调音量
  agent/status/running: { path: $DSH_HOME/sounds/music.mp3, loop: true }  # 循环播放
```

- **配置键**是 dsh 原生事件名（见下表）；**值**是声音文件路径，写成对象可控制 `volume`（0–1，需 ffplay）和 `loop`
- **路径格式**：绝对路径、`~/…`（`$HOME`）、`./…`（`$DSH_HOME`）、`$DSH_HOME/…`
- **开关**：`enabled: false` 可静默所有事件提示音（手动 `/sounds play` 仍有效）
- **试听**：仓库自带示例音 `sounds/done.wav`，复制到任意目录后配置即可用

## 事件 / Events

| 配置键 | 触发时机 |
|---|---|
| `agent/status/running` | 主 agent 回合开始（建议配 `loop: true`） |
| `agent/status/idle` | 主 agent 回合结束、等待你输入（同时停止所有循环播放） |
| `session/created` / `session/disposed` | 会话创建 / 销毁 |
| `agent/created` / `agent/disposed` | agent 注册 / 注销 |
| `agent/session-start` | agent 会话生命周期开始（startup/resume/clear/compact） |
| `agent/error` | 回合出错 |
| `user/message` | 用户消息 |
| `turn/start` / `turn/end` | 回合开始 / 结束 |
| `step/start` / `step/end` | 步骤开始 / 结束 |
| `tool/call` / `tool/result` | 工具调用 / 结果 |
| `approval/asked` | 等待审批（请求发出，等待用户决定） |

`agent/status/running ⇄ idle` 对应一次任务的完整生命周期（Web 客户端里即一次回合）。`agent/status` 的声音**只跟随顶层（主）agent**：subagent 在子会话中运行，其状态翻转不会触发任何声音——后台 subagent 完成时不会响铃，只有主 agent 回合结束、等你下一条消息时才响。

Agent-status sounds follow the **top-level agent only**: subagents run in child sessions and their status flips are inaudible, so a background subagent finishing never chimes — only the main agent's turn end (waiting for your next message) rings. 会话恢复（resume/replay）重放的历史事件会被跳过，不会在启动时提示音轰炸。

## 命令 / Commands

在 Web 输入框输入斜杠命令：

- `/sounds list` — 查看已配置的声音
- `/sounds play <事件名>` — 手动试听
- `/sounds stop` — 停止循环播放中的音乐

## 播放器要求 / Requirements

| 平台 | 播放器 | 备注 |
|---|---|---|
| macOS | `afplay` | 系统自带；音量控制需 `ffplay` |
| Linux | `paplay` / `aplay` | 音量控制需 `ffplay` |
| Windows | PowerShell | 仅 WAV；循环播放需 `ffplay` |

播放失败会被静默忽略，不会影响 agent 运行。自带的默认提示音是 WAV 格式，各平台播放器均原生支持。

## License

MIT
