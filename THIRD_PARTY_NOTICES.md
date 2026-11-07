# 第三方组件与许可说明

NiceTools Neo 的源码（`app/`、`scripts/`、`build/`、`tests/` 下的全部文件）以 **MIT** 许可发布，见 [LICENSE](LICENSE)。
下面列出的第三方组件**各自保留原许可**，不属于 MIT 的授权范围。

---

## Electron 44.7.0

- 项目：https://www.electronjs.org/
- 许可：MIT
- 便携发行包内置官方 win32-x64 运行时。其 MIT 全文在包内保留为
  `LICENSE-Electron-MIT.txt`，Chromium 的许可全文为 `LICENSES.chromium.html`。

## Chromium

- 项目：https://www.chromium.org/
- 许可：BSD 系列及其他宽松许可，全文见运行时的 `LICENSES.chromium.html`。

## FFmpeg（不随源码仓库分发）

- 项目：https://ffmpeg.org/
- **本仓库不包含 FFmpeg 二进制，本项目的发行包也不包含。** 软件通过命令行以
  独立进程的方式调用用户自己提供的 `ffmpeg.exe` / `ffprobe.exe`，不与其链接。
- FFmpeg 的许可取决于用户选择的构建：常见的 `win64-gpl` 构建
  （`--enable-gpl --enable-version3`，含 libx264 / libx265）按 **GPL** 分发；
  `win64-lgpl` 构建按 LGPL 分发。请遵守你所使用构建的许可。
- 获取方式：设置页可直接下载（默认 BtbN 构建），也可以在设置里指定已有的
  `ffmpeg.exe`。下载得到的 FFmpeg 由你自行使用，本项目不代为分发。

## rcedit

- 项目：https://github.com/electron/rcedit
- 许可：MIT
- 仅在构建阶段用于写入 Windows 图标与版本资源，不进入发行包。

## 字体

界面使用系统 UI 字体栈（Segoe UI Variable、Microsoft YaHei UI 等），不分发字体文件。

## 拼音数据 `app/lib/mcsounds/pinyin.json`

- 6763 个 GB2312 常用字的拼音对照表（含 1816 个多音字），仅用于本地搜索的模糊匹配。
- 这是一份事实性对照数据，不含第三方代码。

## Minecraft 相关

- 本项目**不包含任何 Minecraft 的 `.ogg` 音效文件**，也不在仓库内附带 Minecraft 的中文译名数据。
- MC音效页面的工作方式：扫描用户自己链接的本地音效库；或从 Mojang 官方资源索引
  （`piston-meta.mojang.com` → `resources.download.minecraft.net`）按 SHA1 校验下载，
  并在下载时拉取官方 `lang/zh_cn.json` 现场生成中文搜索索引。
- Minecraft、Mojang 名称与相关资源归 Mojang Studios 与 Microsoft 所有。本项目与
  Mojang Studios、Microsoft 无任何关联，也未获其背书。下载功能仅供拥有正版游戏的
  用户在本机整理素材使用，请遵守 Minecraft 最终用户许可协议。
