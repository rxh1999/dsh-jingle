# dsh-jingle

在 dsh（DeepSeek Harness）事件上播放提示音，灵感来自 [pi-jingle](https://github.com/Git-Monke/pi-jingle)，但配置键直接使用 dsh 的原生事件名（`session/created`、`agent/error`、`turn/end`、`tool/call`……），不做二次命名。

Play sounds on dsh events — inspired by [pi-jingle](https://github.com/Git-Monke/pi-jingle), configured with native dsh event names instead of a remapped vocabulary.

## 安装 / Install

1. 把插件装进你的 profile（以 `web` profile 为例）：

   ```bash
   cd ~/.dsh/profiles/web
   pnpm add -w file:/path/to/dsh-jingle        # 或 dsh plugin --profile web add <pkg>
   ```

2. 在 `~/.dsh/profiles/web/cordis.patch.yml` 中加入一行：

   ```yaml
   - insert:
       - id: jingle
         name: dsh-jingle
   ```

3. 重启 dsh（`dsh web`）；已运行的 dsh 也会在 patch 文件变更时热加载。**默认完全静默**——不配置任何声音就不会播放，配置见下。

   > 开发提示：本插件以快照形式装入 profile（`file:` 依赖）。修改源码后重新执行 `cd ~/.dsh/profiles/web && pnpm add -w file:/path/to/dsh-jingle` 刷新快照，再重启生效。

## 配置 / Configuration

在用户设置文档 `$DSH_HOME/settings.yaml`（默认 `~/.dsh/settings.yaml`）中新增 `sounds:` 段，**保存即热重载**，无需重启：

```yaml
sounds:
  agent/status/idle: /absolute/path/to/done.mp3
  turn/end: { path: ./sounds/chime.wav, volume: 0.4 }
  tool/result: ./sounds/tick.wav
  agent/status/running: { path: $DSH_HOME/sounds/music.mp3, loop: true }
```

也可以在 patch 行的 `config:` 中写同样的结构（作为设置的基础层）：

```yaml
- insert:
    - id: jingle
      name: dsh-jingle
      config:
        enabled: true
        sounds:
          agent/status/idle: /path/to/sound.mp3
```

**路径格式 / Path formats：**

- `/absolute/path.mp3` — 绝对路径
- `~/music/a.mp3` — 展开为 `$HOME/music/a.mp3`
- `./sounds/a.mp3` — 展开为 `$DSH_HOME/sounds/a.mp3`
- `$DSH_HOME/sounds/a.mp3` — 展开为 dsh 数据目录

**音量 / Volume：** 条目写成对象即可控制音量（0.0–1.0，需要安装 ffplay）：

```yaml
sounds:
  agent/status/idle: { path: /path/to/sound.mp3, volume: 0.5 }
```

**开关 / Master switch：** `enabled: false` 可静默所有事件提示音（`/sounds play <事件>` 手动播放仍有效）。

**默认 / Default：** 完全静默——`sounds:` 段为空（或不写）时不播放任何声音，需要哪个事件就配置哪个。

**试听 / Try the bundled sound：** 仓库自带一个合成的示例音 `sounds/done.wav`，可拷到自己目录后配置试用（或 `node scripts/gen-done-wav.mjs` 重新生成）。

## 可配置事件 / Supported Events

配置键就是 dsh 的原生事件名（见 harness 事件矩阵 [event-producer-consumer.md](../../docs/event-producer-consumer.md)），分三类：

**Host 生命周期事件（emit）：**

| 配置键 | 触发时机 |
|---|---|
| `session/created` | 会话创建 |
| `session/disposed` | 会话销毁（同时停止循环播放） |
| `agent/created` | agent 注册 |
| `agent/disposed` | agent 注销（同时停止循环播放） |
| `agent/session-start` | agent 会话生命周期开始（startup/resume/clear/compact） |
| `agent/error` | 回合出错 |

**Agent 运行状态（`agent/status` 的两个状态）：**

| 配置键 | 触发时机 |
|---|---|
| `agent/status/running` | 任务开始（agent 从 idle 转为 running；可配 `loop: true` 循环播放） |
| `agent/status/idle` | 任务完成（agent 回到 idle；同时停止所有循环播放） |

**会话日志事件（`session/event` 流）：**

| 配置键 | 触发时机 |
|---|---|
| `user/message` | 用户消息（含注入的上下文消息，如 AGENTS.md、cron 通知） |
| `turn/start` | 回合开始 |
| `turn/end` | 回合结束 |
| `step/start` | 步骤开始（一次模型调用） |
| `step/end` | 步骤结束 |
| `tool/call` | 工具调用 |
| `tool/result` | 工具结果 |

**循环播放 / Looping：** 条目写成对象并加 `loop: true` 即可循环（建议用于 `agent/status/running`，例如编码音乐）。循环会在 `agent/status/idle`、`session/disposed` 或 `agent/disposed` 时停止；同一时刻只保留一个循环，新的会替换旧的。

```yaml
sounds:
  agent/status/running: { path: $DSH_HOME/sounds/music.mp3, loop: true }
```

实现说明：

- `agent/status/running ⇄ idle` 对应「一次任务」的完整生命周期（Web 客户端里即一次回合）；回合内部的更细粒度事件见上面的会话日志事件。
- 会话恢复（resume/replay）会重放历史事件，插件会跳过 `session/end-seed` 标记之前的种子事件，避免启动时提示音轰炸。
- 所有会话（含子代理）的事件都会触发声音；如需只关注主会话，可在配置中只保留所需事件键。

## 命令 / Command

在 Web 输入框输入斜杠命令（由 dsh 命令系统自动发现）：

- `/sounds list` — 列出已配置的声音
- `/sounds reload` — 重新读取配置（settings 热重载下通常无需手动执行）
- `/sounds play <event>` — 手动试听某个事件的声音
- `/sounds stop` — 停止循环播放中的音乐

## 播放器要求 / Requirements

- **macOS**：`afplay`（系统自带）；音量控制需要 `ffplay`（`brew install ffplay`）
- **Linux**：`paplay` / `aplay`；音量控制需要 `ffplay`
- **Windows**：PowerShell（系统自带，仅 WAV）；循环播放需要 `ffplay`

播放失败会被静默忽略，不会影响 agent 运行。自带的默认提示音是 WAV 格式，各平台播放器均原生支持。

## 开发 / Development

```bash
node scripts/gen-done-wav.mjs   # 重新生成默认提示音 sounds/done.wav
node --check src/index.js       # 语法检查
node test/smoke.mjs             # 冒烟测试（需在已安装插件的 profile 目录下运行）
```

冒烟测试在一个最小 cordis 上下文（mock `commands` 服务）中验证：插件可加载、`/sounds` 命令注册、事件处理器不抛异常、命令返回结构正确。

## License

MIT
