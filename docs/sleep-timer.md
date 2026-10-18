# 睡眠定时器（任务 F）

在 Windows“播放器设置”和 Android“设置 → 睡眠定时器”中可设置 15、30、60 分钟预设，或输入 1～240 分钟的整数。定时器到点后只暂停当前实际播放的内容，保留播放器进程、当前歌曲、播放进度和播放队列；不会关闭应用、切换歌曲或修改播放模式。

## 使用与状态

- 同时最多一个有效定时器。重新设置会替换旧定时器，旧截止时间不会再触发暂停。
- “取消定时”立即失效，不改变当前播放状态。
- 开启后显示“睡眠定时器：剩余 X 分 YY 秒”和取消按钮；关闭设置页面、切换歌曲、暂停/继续、切换歌单、在线搜索、修改背景、隐藏到托盘或 Android 前后台切换都不会取消计时。
- 非法输入（0、241、小数、空值）只显示提示，不覆盖正在运行的有效定时器。
- 定时器只存在于本次运行；应用真正退出或 Android 进程被系统终止后不会恢复未完成的定时。不写入歌单备份、云同步或账号数据。

## Windows 计时机制

- Electron 主进程持有唯一权威定时器，核心逻辑位于 `app/src/sleep-timer.cjs`：按截止时间 `endsAt` 调度，不使用渲染层逐秒递减。
- 渲染层通过 `playerAPI.sleepTimer('get' | 'set' | 'cancel')` 经 IPC 设置和查询；界面只按主进程返回的 `endsAt` 显示剩余时间，并订阅主进程推送的状态。
- 主窗口隐藏到托盘后主进程计时器继续有效；恢复窗口会重新同步；真正退出（托盘“退出”、`quit` 命令、`before-quit`）时清理定时器。
- 回调提前触发、系统休眠/唤醒导致延迟、时钟回拨时都会按 `endsAt` 重新计算：提前则重新挂起，晚到则立即到期，且只触发一次。

## Android 计时机制

- `SleepTimer` 是纯 JVM 的截止时间实现（可注入时钟与调度器，已有单元测试）；`SleepTimerHost` 是进程级单例，使用 `SystemClock.elapsedRealtime()` 与主线程 `Handler` 调度，不依赖 WebView 每秒回调。
- Activity 重建不会创建第二个定时器，因为权威状态在进程级宿主中；WebView 界面重新加载后会通过原生桥查询剩余时间。
- 到期时先调用 `AudioController.pauseAll()` 停止原生音频，再发送现有媒体会话同款 `pause` 命令：WebView 页面存活时会让播放引擎暂停 Bilibili 视频并同步状态，同时刷新前台服务通知。
- 不新增权限、不新增常驻服务、不修改包名，复用现有 `PlaybackService` 与 `NativeBridge`。

## 到期暂停语义

到期只对 `playing`、`buffering`、`loading` 状态请求暂停；已经暂停或空闲时只清除定时器，绝不调用播放接口。暂停走现有 `engine.pause()` 路径，该路径不改变当前歌曲、队列、播放模式或播放位置。QQ 音乐、网易云音乐通过音频后端暂停；Bilibili 音频后端与官方网页/视频后端由其现有 `pause` 实现处理。Android 官方网页备用播放本身仍不受支持，与定时器无关。

## 开发与验收

```powershell
cd app
node --test test/*.test.cjs
cd ..
node --test tools/sleep-timer-ui.cjs tools/custom-background-ui.cjs tools/cover-background-ui.cjs app/test/locate-playing-ui.cjs android/locate-playing-ui.cjs tools/search-scope-ui.cjs
$env:MIXTUNES_SLEEP_EXECUTABLE='<本次打包的 MixTunes.exe>'
node --test tools/sleep-timer-electron.cjs
node --test tools/custom-background-electron.cjs tools/cover-background-electron.cjs
node android/build-web.cjs
node --test android/native/test-video-bootstrap.cjs android/native/test-qq-mobile-choice.cjs
& ./android/native/test-sleep-timer.ps1
& ./android/native/test-request-control.ps1
& ./android/native/test-qq-mobile-login.ps1
& ./android/native/test-background-images.ps1
```

Windows 运行级测试使用 `--test-mode` 专用钩子设置秒级时长，该钩子只在 `--test-mode` 下存在，正式使用不可达。Android Java 测试只覆盖纯 JVM 计时核心，浏览器模拟不替代真机。

## 人工验收与限制

- 需要在 Windows 真机确认：托盘隐藏后计时继续、到期暂停、恢复窗口后显示已结束、程序未退出、真实账号下 QQ/网易云/Bilibili 播放被正确暂停。
- 需要在 Android 真机确认：锁屏或返回桌面后的到期暂停、通知栏状态、Activity 重建后剩余时间、系统图片/视频等既有功能不受影响。
- 应用进程被系统强制终止后不唤醒设备、不恢复定时器。
- 未做音量渐弱、定时关机或自动切换歌单，这些不在任务 F 范围内。
