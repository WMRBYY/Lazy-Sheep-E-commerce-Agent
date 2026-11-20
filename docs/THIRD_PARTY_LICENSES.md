# 第三方许可

本项目对自身可许可源码采用 MIT。该许可不替代第三方组件的许可，也不授予第三方商标或模型服务的使用权。

| 组件 | 本仓库依赖声明 | 使用边界 |
| --- | --- | --- |
| Open AI Canvas 源码 | MIT | 保留上游版权与许可声明 |
| Shopify product taxonomy | MIT | 保留分类目录中的 Shopify 许可；这是公共行业分类，不是原站业务数据 |
| tldraw SDK | tldraw SDK License | 当前依赖声明为 5.2.5；生产使用需符合其许可并配置部署者自己的许可密钥 |
| `@ffmpeg/core` | GPL-2.0-or-later | 分发编译后的内核时须满足其许可和对应源代码要求；不将它标为本项目的 MIT 代码 |
| `@ffmpeg/ffmpeg`、`@ffmpeg/util` | MIT | 包装层与内核许可证不同 |
| Inter、JetBrains Mono 及其他附带字体 | OFL 或对应字体许可 | 保留各字体许可证和版权声明 |

tldraw 的生产使用说明见 <https://tldraw.dev/community/license>。本仓库不附带任何生产许可密钥，不绕过第三方许可检查。

FFmpeg WebAssembly 组件与内核许可说明见 <https://ffmpegwasm.netlify.app/docs/faq/>，对应构建源码见 <https://github.com/ffmpegwasm/ffmpeg.wasm>。仓库只发布项目源码与依赖声明，不发布预编译容器或 FFmpeg 二进制。

依赖的确切版本由锁文件决定。部署者重新分发构建产物时，应保留产物中实际包含的第三方许可与源码提供要求；不要将项目的 MIT 声明用于覆盖第三方许可。
