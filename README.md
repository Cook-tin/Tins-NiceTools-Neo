# NiceTools Neo

> 复杂归引擎，简单给你。为 Windows 11 打造的轻量视频工具箱。

[![License: MIT](https://img.shields.io/badge/license-MIT-black.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%2011%20x64-black.svg)](#系统要求)
[![Version](https://img.shields.io/badge/version-1.5.3%20Neo-black.svg)](CHANGELOG.md)

NiceTools Neo 内置 **LiteNX 处理引擎**：以本地 FFmpeg 为底座，叠加 GPU 解码、硬件编码和基于视频帧回调的预览链路。视频不上传，关闭窗口后不留下后台服务。默认使用**关键帧对齐的流复制**导出，几秒内完成；需要帧精确时切换 H.264 精确导出。

当前版本：**1.5.3 Neo**（LiteNX 引擎 / 裁剪 / 格式转换 / MC音效）

> 这是 NiceTools 的**开源版**：以 MIT 许可发布，**不包含**音频解析功能。
> **源码仓库不包含 Electron 和 FFmpeg 二进制**，发行包也不内置 FFmpeg —— 首次使用时请按[首次配置 FFmpeg](#首次配置-ffmpeg)操作。

---

## 下载

- 发行包：<https://github.com/Cook-tin/Tins-NiceTools-Neo/releases>
- 源码：`git clone https://github.com/Cook-tin/Tins-NiceTools-Neo.git`

## 快速开始（便携版）

1. **先把压缩包完整解压到一个普通文件夹**，不要在压缩包预览里直接双击程序。
2. 双击 `NiceTools.exe`。它是一个很小的原生启动器；真正的 Electron 运行时是同目录的 `NiceToolsCore.exe`，请不要直接运行后者。
3. **首次使用先接上 FFmpeg**（见下一节），否则裁剪、转换、导出都不可用。
4. 左侧选择 **视频裁剪**、**解析转换** 或 **MC音效**；视频裁剪页点击大文件夹导入，最近打开在鼠标悬浮文件夹时展开，最多保留 4 项；没有记录时会显示“还没有最近打开的视频”。
5. 工作台右上角显示估算大小和「导出」按钮，点击后在弹窗里选择原编码 / H.264 / GIF / 仅音频，再开始导出。
6. 解析转换页提供格式转换；MC音效页支持链接本地音效库、从 Mojang 官方资源索引下载、中文/拼音搜索、试听和拖拽到剪辑软件；设置入口固定在左侧导航栏底部。

> 1.5+ 只提供便携压缩包，不再提供 Setup 安装程序。设置页保留“选择更新包”选项；解压后直接运行 `NiceTools.exe` 即可。

### 首次配置 FFmpeg

发行包不带 FFmpeg（体积和许可都更干净），首次启动时软件会提示未连接。三种方式任选其一：

1. **设置页一键下载**：设置 → FFmpeg → 下载（默认从 BtbN 的 `win64-gpl` 构建下载，装到 `%APPDATA%\NiceTools Neo\ffmpeg\bin`）。
2. **指定已有的 ffmpeg.exe**：设置 → FFmpeg → 选择文件，指向你电脑上已有的 `ffmpeg.exe`（需要同目录有 `ffprobe.exe`）。
3. **让它自己找**：把 FFmpeg 放进 `PATH`、`C:\ffmpeg\bin`，或通过 WinGet 安装，软件启动时会自动识别。

> FFmpeg 的许可取决于你用的构建：`win64-gpl` 是 GPL，`win64-lgpl` 是 LGPL。软件只以独立进程调用它，不与其链接。详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

### 与自用版的区别

开源版（Neo）与作者自用的 NiceTools 1.5.3 是两条线：

| | NiceTools Neo（开源版） | 自用版 |
| --- | --- | --- |
| 许可 | MIT | GPL-3.0-or-later |
| 网易云音频解析 | 无 | 有 |
| FFmpeg | 用户自行连接 | 内置 |
| 内置 Minecraft 中文索引 | 无（联网时现场生成） | 有 |
| 配置目录 | `%APPDATA%\NiceTools Neo` | `%APPDATA%\NiceTools` |

两者可以同时装在一台电脑上，配置互不覆盖。

### LiteNX 处理引擎

> LiteNX+ 独立引擎项目不在本仓库内；NiceTools 内置的 `app/lib/litenx.js` 是兼容适配层。

- **默认引擎 LiteNX**：FFmpeg + GPU 解码 + NVENC/QSV/AMF/VideoToolbox 等平台硬件编码；Windows 当前使用 D3D11VA / DXVA2 解码与 NVENC/QSV/AMF 编码。
- **预览引擎**：Chromium GPU 解码 + `requestVideoFrameCallback` 帧回调，减少播放时的 JS 轮询；不兼容编码会自动生成代理预览。
- **兼容引擎 FFmpeg**：标准软件处理链路，适合排查硬件兼容问题。
- 设置页可以随时切换 **LiteNX / FFmpeg**；右上角状态胶囊会同步显示当前引擎名称。

### LiteNX 与 FFmpeg 实测

测试机：Intel i5-14500HX / Intel UHD Graphics（无 NVIDIA NVENC），Windows 11。

| 测试 | FFmpeg x264 墙钟 | LiteNX QSV 墙钟 | FFmpeg CPU 时间 | LiteNX CPU 时间 | FFmpeg 峰值内存 | LiteNX 峰值内存 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1080p30 / 10 秒 | 1.12 s | 3.10 s | 9.34 s | 2.19 s | 964 MB | 219 MB |
| 4K30 / 6 秒 | 2.93 s | 4.65 s | 26.14 s | 3.44 s | 3591 MB | 532 MB |

- LiteNX 的 CPU 占用低约 **4.3–7.6 倍**，峰值内存低约 **4.4–6.7 倍**。
- 本机 QSV 的单路墙钟速度并不占优；不能宣称“任何机器单路转码都更快”。有可用 NVENC 的机器会自动优先 NVENC，通常明显快于 x264。
- 纯剪切/无损复制两个引擎都走 `-c copy`，耗时基本一致。
- 完整报告见 `LiteNX-vs-FFmpeg.md`。

### 界面

- 左侧导航：**视频裁剪、解析转换、MC音效**，底部是**内存优化**和**设置**。
- 首页只保留大文件夹和格式标签；最近打开通过悬浮文件夹形变展开。
- 视频工作台只有 **裁剪** 和 **画面** 两个工具。
- 解析转换页支持 MP4（H.264）、MKV（原编码）、MOV（H.264）、M4A、MP3、WAV、FLAC；文件卡片支持取消选择。
- 导出弹窗统一提供：**原编码、H.264、GIF、仅音频（M4A / MP3）**。
- 时间轴为画面 + 音频双轨：鼠标滚轮左右滚动，Ctrl + 滚轮在 0.1×–80× 之间缩放；工具栏提供分割、放大预览、缩放和适应窗口。
- 分割按钮位于放大预览左侧，也可按 **Ctrl + K**；分割后默认选中后半段。
- 放大预览会隐藏标题栏、工具栏和右侧面板，底部时间轴变成带缩略图的进度条；按 Esc 或右上角“退出预览”恢复。
- 自动吸附可开关：拖动出入点手柄或播放头时，吸附到视频边界、另一侧手柄和播放头；不再使用关键帧吸附。
- 空格键始终播放/暂停，即使焦点在画面/音频开关按钮上。
- 时间裁剪和画面裁剪可以同时使用：在“裁剪”里选时间段，切到“画面”调整裁剪框，两者都会保留；画面被修改后视频自动使用 H.264，GIF 导出同样应用画面裁剪。

启动器会主动清掉 `ELECTRON_RUN_AS_NODE` 和 `ELECTRON_ENABLE_LOGGING` 这两个环境变量。某些终端/自动化环境会把 `ELECTRON_RUN_AS_NODE=1` 传给子进程，导致 Electron 以 Node 模式运行、窗口一闪而过；用启动器可以避免这个问题。

如果双击 `NiceTools.exe` 完全没反应，通常是因为程序放在带 Windows 权限保护的工作区目录里。请运行同目录的 `NiceTools.cmd`：它会把整个程序复制到 `%LOCALAPPDATA%\NiceTools Neo` 再启动（只需首次复制）。也可以手动把整个文件夹移到 `C:\NiceTools` 或桌面。

如果启动失败，会弹出一个原生错误对话框，显示退出代码和日志路径；把 `%APPDATA%\NiceTools Neo\logs\main.log` 发到 Issues 即可定位。

**系统要求**：Windows 11 x64（需要 .NET Framework 4.8，Windows 11 自带）。Windows 10 也可以运行，但未做重点测试。

---

## 已实现功能

| 工具 | 说明 |
| --- | --- |
| 单段裁剪 | 时间轴入点/出点，默认关键帧对齐、流复制无损导出 |
| 分割 | 播放头处分割并默认选中后半段；工具栏按钮或 Ctrl + K |
| 画面裁切 | 拖拽裁剪框、比例预设（1:1 / 16:9 / 9:16 / 4:3 …），FFmpeg crop 重编码 |
| 组合编辑 | 时间裁剪与画面裁剪共用同一时间轴和导出，画面修改后自动 H.264 |
| 放大预览 | 隐藏工具栏和侧栏，底部变为带画面的进度条；Esc 退出 |
| 自动吸附 | 可开关；出入点手柄、播放头吸附到边界和另一侧手柄 |
| 导出 GIF | 在导出弹窗选择 GIF，设置帧率/宽度/颜色/循环 |
| 仅导出音频 | 在导出弹窗选择仅音频，输出 M4A 或 MP3 |
| 格式转换 | MP4（H.264）/ MKV（原编码）/ MOV（H.264）/ M4A / MP3 / WAV / FLAC |
| MC音效 | 链接本地 MCSounds 库，中文 / 英文 / 拼音搜索、试听、多选、拖出 WAV，或从 Mojang 官方资源索引下载 |
| 内存优化 | 释放 NiceTools 自身视频预览缓存与工作集，不需要管理员权限 |
| 撤回/重做 | Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y，覆盖入出点、裁剪、分割、片段与格式设置 |
| 设置页面 | 左侧导航底部入口，独立页面管理 LiteNX/FFmpeg 引擎、导出默认值和日志 |
| LiteNX 引擎 | FFmpeg + 硬件解码/编码探测 + GPU 帧回调预览；设置内可切换 FFmpeg 兼容模式 |
| 最近打开 | 最多保留 4 项，可在设置中一键清除；没有记录时悬浮文件夹也会显示空状态浮窗 |
| 导入确认 | 在剪辑中拖入其他视频会先弹出确认，当前编辑内容不会保存记录 |
| 体积估算 | 选择范围、格式、画质变化时实时估算导出大小，显示在右上角导出按钮旁 |
| 导出弹窗 | 右上角统一导出；弹窗内确认格式、轨道、画质、输出位置、替换原视频 |
| 双轨时间轴 | 画面轨 + 音频轨；滚轮横向滚动，Ctrl + 滚轮缩放；轨道头可显示/隐藏画面、静音音频 |
| 替换原视频 | 导出完成后把原文件移入回收站，新文件使用原名（可撤销） |
| 开关轨道 | 导出时可保留/去掉视频或音频轨 |
| FFmpeg 管理 | 首次启动连接、内置检测、自动下载、手动选择、版本显示 |
| 双击/拖拽打开 | 支持从资源管理器拖入视频，也支持命令行传入文件路径 |

### 设计取舍

- **默认无损、关键帧对齐**：MP4/H.264/H.265 只能从关键帧开始解码。为了让「导出快」成立，无损模式会把入点对齐到关键帧；最长会包含一个 GOP 的预滚数据（播放时由 edit list 隐藏，文件会略大）。需要严格帧精确时，用「MP4 · H.264」精确导出。
- **H.264 精确导出优先使用 NVENC**：启动时探测 NVIDIA 硬件编码器，可用则用 `h264_nvenc`，否则回退 `libx264`。可在设置中强制软件编码。
- **大小估算**：无损模式按实际数据包大小 + 关键帧预滚估算；重编码按分辨率/帧率/画质模型估算，属于「约」值。
- 清晰度预览遇到 Chromium 不支持的编码时，会自动在后台生成低分辨率代理；预览保留当前画面，代理完成后自动切换，导出仍使用原文件。
- 左侧「内存优化」只整理 NiceTools 自身缓存与工作集，不需要管理员权限，也不会清空系统 standby 列表。
- **不内置 FFmpeg**：软件只以独立进程调用你提供的 FFmpeg，既让发行包更小，也让许可边界更清晰。

---

## 项目结构

```
app/                     Electron 应用（无需构建，经典脚本）
  main.js                主进程：窗口、生命周期、IPC
  preload.js             contextBridge 白名单
  lib/
    ffmpeg.js            FFmpeg 定位 / 下载 / NVENC 探测
    probe.js             ffprobe 元数据、关键帧
    media.js             缩略图、波形、体积估算、代理预览
    commands.js          纯函数：所有 FFmpeg 参数
    exporter.js          导出任务编排、进度、替换原视频
    mcsounds/            MC音效扫描、官方索引下载、中文索引、拖拽 WAV
    litenx.js            LiteNX 引擎能力探测：GPU 解码 / 硬件编码 / 平台预览
    server.js            127.0.0.1 媒体服务器（支持 Range）
    settings.js / logger.js / proc.js / ipc.js / util.js
  renderer/
    index.html
    styles.css           iOS 风格的黑白界面
    js/                  经典脚本，按顺序加载，无打包步骤
      home.js            左侧导航、首页文件夹选择器、最近打开
      editor.js          视频工作台、时间轴、导出弹窗
      convert.js         格式转换
      mcsounds.js        MC音效页面
      memory.js          内存优化面板
      hub.js             解析转换页
      settings-page.js   独立设置页
      timeline.js / panels.js / modals.js / app.js
resources/ffmpeg/bin/    开发用 FFmpeg（不提交到 git）
runtime-electron/        开发用 Electron 44.7.0（不提交到 git）
scripts/                 下载依赖、编译原生小工具、生成图标/测试素材、打包
tests/                   引擎集成测试 + 渲染烟测
```

### 技术选择

- **Electron 44.7.0**：本机没有 Rust/.NET 工具链，且需要 Chromium 的 H.264 播放与成熟的桌面能力，因此选择 Electron。启动路径做了优化：窗口 `show:false` + `ready-to-show`、无框架菜单、首屏不加载 FFmpeg。
- **无打包步骤**：主进程和渲染层都是普通 JavaScript。渲染层用经典 `<script>` 而不是 ES Module，避免 `file://` 下模块脚本的 CORS 限制。
- **FFmpeg 独立进程**：崩溃隔离、易替换、许可边界清晰。所有子进程输出重定向到临时文件而不是管道，这是在受限 Windows 环境里也能工作的关键（管道在部分沙箱中会被拒绝）。
- **本地 HTTP 媒体服务器**：`<video>` 需要 Range 请求才能流畅拖动，`file://` 在跨源和打包场景下不可靠，因此主进程启动一个仅监听 `127.0.0.1` 的随机端口服务器，用随机 token 映射已授权的文件。

---

## 开发

### 环境

- Windows 10/11 x64
- Node.js 22+
- .NET Framework 4.x（Windows 自带 `csc.exe`）
- 可选：Python 3 + Pillow（重新生成图标）

源码仓库不提交 `runtime-electron/`、`ffmpeg.exe`、`dist/`、测试素材和截图生成产物；
这些都可以由脚本重新下载或生成。

```powershell
# 1. 取 Electron（约 158 MB，官方 GitHub Release）
node scripts/fetch-electron.mjs

# 2. 取 FFmpeg（约 192 MB，GPL 构建）——只有开发/完整包需要
node scripts/fetch-ffmpeg.mjs

# 3. 生成测试素材（可选）
node scripts/make-test-media.mjs

# 4. 启动
.\runtime-electron\electron.exe .\app
```

> 网络无法直连 GitHub 时，可以设置 `NICETOOLS_ELECTRON_URL` 或
> `NICETOOLS_FFMPEG_URL` 指向镜像，而不是修改源码。
>
> 如果当前终端里存在 `ELECTRON_RUN_AS_NODE=1`，Electron 会以 Node 模式启动并报错。先执行 `Remove-Item Env:ELECTRON_RUN_AS_NODE`，或使用 `NiceTools.cmd` / 设置里清空该变量。

### 测试

```powershell
node tests/render.test.js   # 无需浏览器：渲染首页和所有模式面板，检查模板错误
node tests/engine.test.js   # 真实 FFmpeg：裁剪/编码/裁切/GIF/音频/拼接/分割/替换/估算
```

引擎测试会写入 `test-output/`，需要 `test-media/sample-30s.mp4` 与 `sample-8s.mp4`（`make:test-media` 生成）。

### 打包

```powershell
# 1. 编译原生启动器、内存辅助程序和更新器
npm run build:native

# 2. 组装便携目录 + zip（--no-ffmpeg 表示不内置 FFmpeg）
npm run build:no-ffmpeg

# 3. 生成离线更新包（不会自动删除）
npm run build:update
```

`build:native` 需要 Windows 自带的 .NET Framework 4.x `csc.exe`。

产物：

- `dist/NiceTools/` — 可直接运行的便携目录（启动器 + Electron + 应用）
- `dist/NiceTools-Neo-portable.zip` — 便携发行包
- `dist/NiceTools-Neo-update-1.5.3.zip` — 离线更新包，包含 `NiceToolsUpdater2.exe`
- `LiteNX-vs-FFmpeg.md` — 本机实测性能对比

不带 `--no-ffmpeg` 时会额外把 `resources/ffmpeg/bin` 打进包里（自用/完整包用）。

打包脚本会把 `electron.exe` 重命名为 `NiceToolsCore.exe`，把原生启动器放到 `NiceTools.exe`，并裁剪无用语言包。启动器的图标和版本信息由 C# 编译器直接写入；Electron 本体不再被 rcedit 修改，避免改动大型运行时带来的兼容风险。

---

## 已知限制（v1）

- 多段拼接目前以**整个文件**为单位，不支持在列表里二次裁剪某一段；可以先用「裁剪」处理，再拼接。
- 只使用第一条视频轨和第一条音频轨；字幕、章节、多音轨会被丢弃。
- 无损裁剪的入点会对齐关键帧；输出可能包含最多一个 GOP 的隐藏预滚数据。
- HDR / 10bit 源在转 H.264 时会丢失 HDR（界面会提示）。无损复制不受影响。
- 预览依赖 Chromium 的解码能力；不支持的编码需要生成代理预览。
- 便携包体积较大（Electron 运行时占大头），后续可迁移到 Tauri / 原生外壳。
- 未做代码签名，首次运行可能出现 SmartScreen 提示。

---

## 许可

NiceTools Neo 以 **MIT** 许可发布，见 [LICENSE](LICENSE)。

- Electron / Chromium：MIT / BSD 系列许可，完整文本随运行时附带。
- FFmpeg：不随本项目分发，由使用者自行提供；其许可取决于所用构建。详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

本项目不收集遥测；所有视频处理均在本机完成。

Minecraft、Mojang 是 Mojang Studios / Microsoft 的商标或资源，本项目与其无关联。
