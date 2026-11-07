# Changelog

## 1.5.3 Neo（开源版）

首个公开发布的开源版本。功能与自用版 1.5.3 基本一致，差异如下：

- **改用 MIT 许可**。自用版历史上的版本仍为 GPL-3.0-or-later。
- **移除网易云音频解析**（`lib/netease.js`、`renderer/js/audio.js` 及其 IPC 通道）。
  自用版保留该功能，开源版不含。
- **发行包不再内置 FFmpeg**。首次使用时在设置页选择自己的 `ffmpeg.exe`，或点击
  设置页的下载按钮；软件也自动识别 PATH、`C:\ffmpeg\bin`、WinGet 安装的 FFmpeg。
- **不再内置 Minecraft 中文索引**。音效下载时从官方 `lang/zh_cn.json` 现场生成
  `zh-index.json`；未能联网时搜索退化为英文事件名。
- 独立应用标识 `nicetools-neo`、窗口名 `NiceTools Neo`，与自用版共用同一台电脑时
  配置目录互不覆盖。
- 发行包命名改为 `NiceTools-Neo-portable.zip` / `NiceTools-Neo-update-<版本>.zip`。

## 1.5.3

- 内置 MC音效搜索器，替代外部 `NT-addon-Search` 插件。
  - 本地 MCSounds 库扫描、中文/英文/拼音搜索、试听、多选。
  - 从 Mojang 官方资源索引下载音效，下载后生成 `manifest.json` 和中文
    `zh-index.json`。
  - 拖出 WAV / 原始 OGG；保留原有 `localStorage` 配置。
  - 下载增加 SHA1 校验和路径安全校验。
- 更新包继续使用 `NiceToolsUpdater2.exe`，不自动删除所选更新包。
- 保留 1.5.2 的内存优化、导出位置、撤回、音频格式等功能。

## 1.5.2

- 新增安全内存优化面板。
- 音频解析支持 M4A / MP4 音频 / MP3，并可从解析结果前往格式转换。
- 格式转换支持取消选择当前文件。
- 更新后提示版本升级，更新包不再自动删除。
- 修复预览兼容代理、输出路径、默认导出目录等问题。

## 1.5.1

- 自动生成预览代理，避免不兼容编码时大面积黑屏。
- Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y 撤回与重做。
- 导出位置显示和默认导出目录设置。

## 1.5.0

- LiteNX 引擎、GPU 解码/硬件编码适配。
- 视频裁剪、画面裁切、GIF、仅音频导出。
- 网易云音频解析和格式转换。
