# 分镜工作台

把 `srt-to-storyboard` 技能导出的分镜 CSV，变成一张可操作的无限画布：
每个镜头一张卡片，按 SRT 时间轴横向排布、按锚点 A / B 分两条泳道；
在卡片上生成首帧图，选中、比较、改提示词后重跑，最后把所有首帧按镜头时长合成 1080p animatic。

当前为 **P0 + 合成**：首帧图与本地视频合成。AI 视频生成、参考图节点、成本面板在路线图里。

## 快速开始

```bash
cd C:\project\storyboard-workbench
npm install

# 开发模式：API :8787 + Vite :5173
npm run dev
# 打开 http://localhost:5173

# 或构建后单端口运行
npm run build
npm start
# 打开 http://127.0.0.1:8787

# 单元测试：提示词拼装、字幕拆分、比例换算、每日用量
npm test
```

合成视频依赖 **ffmpeg**：默认从 `PATH` 查找，也可以用 `.env` 的 `FFMPEG_PATH` 指定可执行文件。

首次启动是 mock 模式，生成本地 SVG 占位图，不花钱，用来跑通流程。
示例 CSV 在 `samples/10月28日-提示词.csv`（31 个镜头，3 分 22 秒）。

## 工作流

1. **导入 CSV**：顶栏「导入 CSV」选择 `expand_prompts.mjs` 导出的 11 列文件。
   - 每个镜头生成一张节点卡，`x = SRT 起始秒 × 100px`，A/B 锚点分泳道。
   - 导入是**替换**语义；提示词未变的镜头会保留已生成的图（`reused` 数会提示）。
2. **生成首帧**：卡片上「生成首帧」→ 任务进队列，SSE 实时刷新进度与缩略图。
   - 队列并发可在系统设置里调整；每日上限由 `.env` 的 `DAILY_IMAGE_CAP` 控制。
   - 相同提示词 + 相同模型/尺寸/张数会命中幂等，直接跳过；卡片上的「再生成」会强制重跑。
3. **挑选**：点缩略图看大图，灯箱里「设为选用图」；节点上「选」也可直接切换。
   右侧检查器首帧右上角可上传本地图片替换当前首帧（没有首帧时也可直接用上传图），或下载当前图。
4. **改提示词**：点节点打开右侧检查器，改中文/英文提示词或负面词 → 保存 → 卡片出现
   「提示词已修改」→ 重新生成。旧候选图保留，便于对比。
5. **批量生成**：按住 Shift 拖拽框选或按住 Ctrl 点击多选镜头，顶部选择栏点「批量生成」，
   默认只跑没有图、失败、提示词已改或模型/尺寸变化的镜头；勾选「已有首帧也重新生成」可全部重跑，
   正在生成或排队的镜头会自动跳过。单次批量上限默认 50（可在系统设置调整），超出时弹窗会直接拦下。
6. **合成视频**：顶栏「合成视频」把每个镜头选中的首帧按 SRT 时长铺满、硬切拼接，
   可选择 `720p / 1080p / 4K`、`24 / 25 / 30fps`、留黑边或裁剪填满、标准或高清画质，
   以及每镜「无 / 推近 / 拉远」的轻微 Ken Burns 运镜；
   缺首帧时默认拦下，也可以勾选「跳过」只合成已有镜头。
   完成后可在弹窗里直接预览、下载，最近 20 次记录保留在 `data/exports.json`。

## 接入真实生图端点

### AIClone（GPT Image 2 / Gemini 3.1 Flash Image）

顶栏齿轮「系统设置」可以直接填 API Key、切换默认模型、选择送模型的提示词语言，并调整生成限制；
保存在 `data/settings.json`，Key 只在服务端读取，不会下发到浏览器。也可以走环境变量：

```ini
IMAGE_PROVIDER=aiclone       # 默认；mock 仅用于本地测试
AICLONE_API_KEY=sk-...
AICLONE_IMAGE_MODEL=gpt-image-2
```

- 模型：`gpt-image-2`（GPT Image 2，最多 4 张参考图）、
  `gemini-3.1-flash-image-preview`（Gemini 3.1 Flash Image，最多 14 张参考图）。
- 接口：`POST /api/v2/image/generate` 建任务，再轮询 `GET /api/v2/tasks/{task_id}` 取图。
- 尺寸：AIClone 只接受 `1:1 / 16:9 / 9:16`，服务端会按 `IMAGE_SIZE` 自动换算。
- 计费：每张首帧 3 credits。

### OpenAI 兼容端点

把供应商切到 `openai`（任意兼容 `POST /images/generations` 的服务）：

```ini
IMAGE_PROVIDER=openai
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=sk-...
IMAGE_MODEL=gpt-image-1
IMAGE_SIZE=1536x1024
```

兼容性约定：

| 项目 | 行为 |
| --- | --- |
| 批量 | 每个候选图单独发一次请求（`n=1`），避免端点不支持 `n>1` |
| 返回 | `b64_json` 与 `url` 都支持；相对 URL 按 `OPENAI_BASE_URL` 解析 |
| `response_format` | 默认 `auto` 不发送，兼容 gpt-image-1 与 DALL·E 系的差异；可显式设 `b64_json` / `url` |
| 负面词 | 生图 API 没有原生负面词参数，默认以 `Avoid: ...` 追加到 prompt 末尾，`APPEND_NEGATIVE=false` 可关 |
| seed | 默认不发送（部分端点会 400），需要时 `REQUEST_SEED=true` |
| 自定义鉴权 | `IMAGE_EXTRA_HEADERS={"x-api-key":"..."}`，也支持 `IMAGE_EXTRA_BODY` 追加请求体 |
| 尺寸 | **按模型填**：gpt-image-1 只接受 `1024x1024 / 1536x1024 / 1024x1536`；dall-e-3 接受 `1792x1024`；多数兼容端点接受 `1280x720` |

默认送中文提示词，可在「系统设置 → 送模型提示词」或 `.env` 的 `PROMPT_LANG=en` 切到英文。

### 生成限制

「系统设置 → 生成限制」可以查看今日全局用量并修改以下护栏，保存后立即生效（页面设置优先于 `.env`）：

| 项目 | 默认 | 范围 | 说明 |
| --- | --- | --- | --- |
| 并发数 | `2` | 1–8 | 同时生成的首帧数量，队列会按新值立即调度 |
| 单次批量上限 | `50` | 1–500 | 一次批量提交的镜头数上限，超出会被服务端拒绝 |

每日生成上限由 `.env` 的 `DAILY_IMAGE_CAP` 控制（默认 `200`，按自然日重置，所有项目共享同一份计数）；达到上限后停止提交，可在设置里的用量卡片重置当日计数。其余环境变量为 `IMAGE_CONCURRENCY`、`MAX_BATCH_SIZE`。

## 数据与幂等

```
data/
  usage.json          # 全局每日生成计数（所有项目共享）
  projects/<id>/
    project.json      # 节点、边、每镜 run 状态
    assets/<nodeId>/  # 候选图，文件名带时间戳+随机串
    exports/          # 合成好的 MP4（storyboard-YYYYMMDD-HHMMSS.mp4）
    exports.json      # 最近 20 次合成记录
  settings.json       # 系统设置：生图服务、默认模型、AIClone Key、生成限制
```

- 幂等签名 = `promptHash + provider + model + size + 张数`。命中且候选数足够时跳过。
- 改提示词会重算 `promptHash`，旧图标记 stale；重新生成或清空时回收不再被引用的图片文件。
- 候选图自动选第一张；点击「选」写入 `selectedId`。
- 批量生成中单张失败会重试一次，仍失败时记录错误并继续生成其余镜头。
- 画布上方浮动条里的「任务」实时显示当前队列进度（完成数/总数），展开可查看进行中/失败任务、单条取消或重试；队列空闲且无失败任务时入口自动隐藏。「停止全部」会清空排队并从供应商中断已发出的请求。
- 服务重启时，上次未完成的 `queued / running` 任务会标成失败并提示重新生成，不会永远转圈。
- 删掉 `data/` 即恢复空画布（候选图一并删除）。

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/project` | 项目 + 节点 + 边 + 运行配置/用量 |
| GET | `/api/settings` | 生图服务、默认模型、Key 掩码 |
| PATCH | `/api/settings` | `{provider, imageModel, apiKey, promptLang, concurrency, maxBatch}`，保存系统设置 |
| POST | `/api/import` | `{csv, name, sourceFile}`，替换画布 |
| PATCH | `/api/nodes/:id` | 位置、文案、提示词、负面词 |
| POST | `/api/nodes/:id/generate` | `{n, force, seed}` |
| POST | `/api/nodes/:id/select` | `{candidateId}` |
| POST | `/api/nodes/:id/upload` | `{dataUrl, filename}`，上传本地图片作为当前首帧（≤32 MB） |
| DELETE | `/api/nodes/:id/run` | 清空该镜的候选记录，并删除不再被引用的图片文件 |
| POST | `/api/generate/batch` | `{nodeIds?, scope?, n, force}`，`nodeIds` 优先 |
| POST | `/api/jobs/cancel` | 取消当前项目排队中和进行中的生成任务 |
| POST | `/api/jobs/:nodeId/cancel` | 取消单个镜头的生成任务（排队中或进行中） |
| POST | `/api/usage/reset` | 今日生成计数清零（不删图） |
| GET | `/api/exports` | 当前合成任务 + 历史记录 |
| POST | `/api/exports` | `{width,height,fps,fit,quality,motion,allowMissing}`，开始合成（`fit=contain/cover`，`quality=standard/high`，`motion=none/in/out`） |
| GET | `/api/exports/:id` | 单个合成任务 |
| POST | `/api/exports/:id/cancel` | 取消正在进行的合成 |
| GET | `/api/events` | SSE，`run` / `settings` / `export` 事件 |
| GET | `/assets/:nodeId/:file` | 候选图静态文件 |
| GET | `/exports/:file` | 合成视频静态文件（支持 Range） |

## 结构

```
server/
  index.mjs          Express 路由 / SSE / 静态资源
  config.mjs         .env 解析与运行配置
  csv.mjs            RFC4180 CSV 解析（支持引号内换行、BOM、CRLF）
  import.mjs         列名映射、时间码解析、自动布局、校验提示
  store.mjs          JSON 存储（原子写）
  jobs.mjs           内存队列、并发、幂等、预算护栏
  exports.mjs        ffmpeg 合成队列（逐镜渲染 + concat）
  providers/         mock（SVG 占位）/ openai（兼容端点）
web/
  src/App.tsx        React Flow 画布 + SSE
  src/components/    节点、检查器、导入弹窗、灯箱、顶栏
  src/store.ts       zustand 状态
```

## 已知边界与下一步

- 节点位置暂不随 CSV 持久化；重新导入会回到时间轴布局（图片与选中状态保留）。
- 没有参考图/角色一致性节点，也还没有多轮对话式改图。
- P1：参考图节点与 `reference` 边、任务中断恢复、成本统计、视频节点（消费首帧 + `视频提示词`）。
- P2：AI 视频节点（消费首帧 + 视频提示词）、按镜头裁剪/转场、字幕烧录。

## 排错

- **端口占用**：改 `.env` 的 `PORT`；`npm run dev` 的 Vite 代理会自动读取。
- **生成失败 400**：先核对 `IMAGE_SIZE` 是否被模型支持；再试 `IMAGE_RESPONSE_FORMAT=auto`、`REQUEST_SEED=false`。
- **401 / 缺 Key**：`OPENAI_API_KEY` 只在服务端读取，不会下发到浏览器。
- **合成报「未找到 ffmpeg」**：安装 ffmpeg 并加入 `PATH`，或在 `.env` 里设置 `FFMPEG_PATH=C:\ffmpeg\bin\ffmpeg.exe`。
- **CSV 缺列**：必须是 `expand_prompts.mjs` 的 11 列；镜号、SRT 起止、至少一种提示词是必需列。
- **中文乱码**：解析器会去 BOM，CSV 请用 UTF-8 保存。
