# 分镜工作台

把 `srt-to-storyboard` 技能导出的分镜 CSV，变成一张可操作的无限画布：
每个镜头一张卡片，按 SRT 时间轴横向排布、按锚点 A / B 分两条泳道；
在卡片上生成首帧图（支持一次出 4 张候选），选中、比较、改提示词后重跑。

当前为 **P0**：只做首帧图。视频生成、参考图节点、成本面板在路线图里。

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
```

首次启动是 mock 模式，生成本地 SVG 占位图，不花钱，用来跑通流程。
示例 CSV 在 `samples/10月28日-提示词.csv`（31 个镜头，3 分 22 秒）。

## 工作流

1. **导入 CSV**：顶栏「导入 CSV」选择 `expand_prompts.mjs` 导出的 11 列文件。
   - 每个镜头生成一张节点卡，`x = SRT 起始秒 × 100px`，A/B 锚点分泳道。
   - 导入是**替换**语义；提示词未变的镜头会保留已生成的图（`reused` 数会提示）。
2. **生成首帧**：卡片上「生成 4 张」→ 任务进队列，SSE 实时刷新进度与缩略图。
   - 队列并发、每日上限都在 `.env` 里控制。
   - 相同提示词 + 相同模型/尺寸/张数会命中幂等，直接跳过；卡片上的「再生成」会强制重跑。
3. **挑选**：点缩略图看大图，灯箱里「设为选用图」；节点上「选」也可直接切换。
4. **改提示词**：点节点打开右侧检查器，改中文/英文提示词或负面词 → 保存 → 卡片出现
   「提示词已修改」→ 重新生成。旧候选图保留，便于对比。
5. **批量补图**：顶栏「生成缺失」只跑没有图、失败、或提示词已改的镜头。
   「更多 → 全部重跑」会无视已有结果全量重跑（有二次确认，注意额度）。

## 接入真实生图端点

编辑 `.env`，把供应商切到 `openai`（任意兼容 `POST /images/generations` 的服务）：

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

选中文提示词送模型就设 `PROMPT_LANG=zh`（默认 `en`）。

## 数据与幂等

```
data/
  project.json        # 节点、边、每镜 run 状态、今日用量
  assets/<nodeId>/    # 候选图，文件名带时间戳+随机串
```

- 幂等签名 = `promptHash + provider + model + size + 张数`。命中且候选数足够时跳过。
- 改提示词会重算 `promptHash`，旧图标记 stale，不自动删除。
- 候选图自动选第一张；点击「选」写入 `selectedId`。
- 服务重启时，上次未完成的 `queued / running` 任务会标成失败并提示重新生成，不会永远转圈。
- 删掉 `data/` 即恢复空画布（候选图一并删除）。

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/project` | 项目 + 节点 + 边 + 运行配置/用量 |
| POST | `/api/import` | `{csv, name, sourceFile}`，替换画布 |
| PATCH | `/api/nodes/:id` | 位置、文案、提示词、负面词 |
| POST | `/api/nodes/:id/generate` | `{n, force, seed}` |
| POST | `/api/nodes/:id/select` | `{candidateId}` |
| DELETE | `/api/nodes/:id/run` | 清空该镜的候选记录（不删文件） |
| POST | `/api/generate/batch` | `{scope:'missing'|'all', n, force}` |
| POST | `/api/usage/reset` | 今日生成计数清零（不删图） |
| GET | `/api/events` | SSE，`run` 事件携带节点状态与今日用量 |
| GET | `/assets/:nodeId/:file` | 候选图静态文件 |

## 结构

```
server/
  index.mjs          Express 路由 / SSE / 静态资源
  config.mjs         .env 解析与运行配置
  csv.mjs            RFC4180 CSV 解析（支持引号内换行、BOM、CRLF）
  import.mjs         列名映射、时间码解析、自动布局、校验提示
  store.mjs          JSON 存储（原子写）
  jobs.mjs           内存队列、并发、幂等、预算护栏
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
- P2：批量导出选中首帧、按镜头顺序合成 animatic（ffmpeg）。

## 排错

- **端口占用**：改 `.env` 的 `PORT`；`npm run dev` 的 Vite 代理会自动读取。
- **生成失败 400**：先核对 `IMAGE_SIZE` 是否被模型支持；再试 `IMAGE_RESPONSE_FORMAT=auto`、`REQUEST_SEED=false`。
- **401 / 缺 Key**：`OPENAI_API_KEY` 只在服务端读取，不会下发到浏览器。
- **CSV 缺列**：必须是 `expand_prompts.mjs` 的 11 列；镜号、SRT 起止、至少一种提示词是必需列。
- **中文乱码**：解析器会去 BOM，CSV 请用 UTF-8 保存。
