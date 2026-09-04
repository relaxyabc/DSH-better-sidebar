---
name: sync-fork-upstream
description: >
  同步 DSH-better-sidebar 的 fork 仓库（relaxyabc/DSH-better-sidebar）与上游仓库（omdsh-dev/DSH-better-sidebar）。
  当用户说"同步上游"、"sync fork"、"同步 fork"、"拉取上游"、"pull upstream"、"更新 fork"、"跟上上游"、
  "落后了"、"behind upstream"、"合并上游"、"merge upstream"、"fetch upstream" 时必须使用此 skill。
  即使用户只说"同步一下"、"帮我更新"、"拉一下最新代码"且上下文在 DSH-better-sidebar 仓库中，也应触发。
  不要尝试手动逐步执行——直接加载此 skill 然后按步骤走。
---

# 同步 Fork 与上游仓库 / Sync Fork with Upstream

> 将 `relaxyabc/DSH-better-sidebar`（fork）与 `omdsh-dev/DSH-better-sidebar`（上游）同步到最新。

## 仓库信息 / Repository Info

<!-- fork 仓库（你自己的） -->
- **Fork (origin)**: `https://github.com/relaxyabc/DSH-better-sidebar.git`
<!-- 上游原仓库 -->
- **Upstream**: `https://github.com/omdsh-dev/DSH-better-sidebar.git`
<!-- 本地工作目录 -->
- **本地路径 / Local path**: `E:\owner\DSH-better-sidebar`
<!-- 主分支 -->
- **分支 / Branch**: `main`

## 前置检查 / Pre-flight

在开始同步前，按顺序执行以下检查。任何一步失败都要停下来报告用户，不要继续。

### ① 检查工作区是否干净 / Check clean working tree

```powershell
git status --porcelain
```

如果输出不为空——说明有未提交的修改。**先处理掉再同步**：要么 `git stash` 暂存，要么 `git commit` 提交。绝不能在有脏工作区的情况下 merge。

> 如果决定 stash：同步完成后用 `git stash pop` 恢复。

### ② 验证本地代理是否存活 / Verify local proxy

```powershell
Test-NetConnection -ComputerName 127.0.0.1 -Port 7897 -WarningAction SilentlyContinue | Select-Object TcpTestSucceeded
```

如果 `TcpTestSucceeded` 为 `False`——本地代理没启动。提醒用户启动 Clash/V2Ray 后再试。

## 代理配置 / Proxy Config

<!-- 
  这台机器访问 GitHub 必须走代理。
  环境变量 HTTP_PROXY/HTTPS_PROXY 指向公司代理 (172.30.8.5:3128)，经常返回 502。
  Windows 系统代理是 127.0.0.1:7897（本地 Clash/V2Ray），稳定可靠。
  所以每个联网 git 命令都需要：
  1. 清掉环境变量代理
  2. 用 git -c 显式指定系统代理
-->

本机环境变量中的 `HTTP_PROXY`/`HTTPS_PROXY` 指向公司代理（`172.30.8.5:3128`），经常 502 超时。**所有联网 git 命令**必须清掉这些环境变量，改走 Windows 系统代理 `127.0.0.1:7897`：

```powershell
$env:HTTP_PROXY=''; $env:HTTPS_PROXY=''; $env:http_proxy=''; $env:https_proxy=''; git -c http.proxy=http://127.0.0.1:7897 <具体命令>
```

> 本地命令（`checkout`、`status`、`add`、`commit`、`remote -v`、`branch`）不需要这段前缀。只有 `fetch`、`merge`、`push`、`pull`、`remote add` 需要。

## 同步步骤 / Sync Steps

按顺序执行，每步完成后检查结果再继续。

### 1. 验证 remote 配置 / Verify remotes

```powershell
git remote -v
```

- `origin` 必须指向 `https://github.com/relaxyabc/DSH-better-sidebar.git`
- `upstream` 必须指向 `https://github.com/omdsh-dev/DSH-better-sidebar.git`

如果缺少 `upstream`，添加它：

```powershell
$env:HTTP_PROXY=''; $env:HTTPS_PROXY=''; $env:http_proxy=''; $env:https_proxy=''; git -c http.proxy=http://127.0.0.1:7897 remote add upstream https://github.com/omdsh-dev/DSH-better-sidebar.git
```

### 2. 从上游拉取最新 / Fetch upstream

```powershell
$env:HTTP_PROXY=''; $env:HTTPS_PROXY=''; $env:http_proxy=''; $env:https_proxy=''; git -c http.proxy=http://127.0.0.1:7897 fetch upstream
```

观察输出：
- 如果显示 `[new branch]`、`[new tag]` 或 `abc123..def456  main -> upstream/main`——说明有更新，继续。
- 如果无任何输出——说明已经是最新，跳到步骤 7 直接 push（如果有本地未推送的 merge commit）或报告"已是最新"。

### 3. 切换到 main 分支 / Checkout main

```powershell
git checkout main
```

如果已经在 main 上，此命令为 no-op（无副作用）。

### 4. 合并上游 / Merge upstream/main

```powershell
$env:HTTP_PROXY=''; $env:HTTPS_PROXY=''; $env:http_proxy=''; $env:https_proxy=''; git -c http.proxy=http://127.0.0.1:7897 merge upstream/main --no-edit
```

**三种可能结果：**

- ✅ **`Merge made by the 'ort' strategy.`**（或 `Fast-forward`）——无冲突，直接跳到步骤 6。
- ⚠️ **`Automatic merge failed`**——有冲突，继续步骤 5。
- ℹ️ **`Already up to date.`**——已是最新，跳到步骤 7。

### 5. 解决冲突 / Resolve conflicts

冲突通常发生在 locale 文件（`src/client/locales-*.ts`）——两边都新增了翻译 key。fork 极少有意修改 locale，所以直接取上游版本：

```powershell
git checkout --theirs src/client/locales-*.ts
```

对于其他文件的冲突，先列出冲突文件：

```powershell
git diff --name-only --diff-filter=U
```

然后逐个判断：
- fork 的改动（如 `src/client/EditorHost.tsx` 的 `key: reloadSeq`）通常已被自动合并，不需要手动处理。
- 如果出现了意料之外的冲突文件，报告用户并说明冲突内容，等待用户决策。
- 上游的版本是权威来源——不确定时优先取上游（`--theirs`）。

### 6. 暂存并提交合并 / Stage and commit

```powershell
git add -A
git commit -m "Merge upstream/main: sync to latest"
```

> 如果 merge 时已经自动提交（`Merge made by the 'ort' strategy.`），这一步的 `git add -A` 无副作用，`git commit` 会因为没有待提交内容而安全失败——直接用 `git log -1 --oneline` 确认 merge commit 存在即可。

### 7. 推送到 origin / Push to origin

```powershell
$env:HTTP_PROXY=''; $env:HTTPS_PROXY=''; $env:http_proxy=''; $env:https_proxy=''; git -c http.proxy=http://127.0.0.1:7897 push origin main
```

## 完成后验证 / Post-sync

推送成功后，确认最终状态：

```powershell
git log --oneline -3
```

应该看到最新的 merge commit 在顶部。然后访问 `https://github.com/relaxyabc/DSH-better-sidebar`，确认显示 "This branch is even with omdsh-dev:main"。

## 常见故障排查 / Troubleshooting

### fetch 失败：502 / CONNECT tunnel failed

环境变量代理没清干净。确认每个联网命令前都加了完整前缀：

```powershell
$env:HTTP_PROXY=''; $env:HTTPS_PROXY=''; $env:http_proxy=''; $env:https_proxy=''; git -c http.proxy=http://127.0.0.1:7897 ...
```

### fetch 失败：Could not connect to server

本地代理没启动。检查 `127.0.0.1:7897` 是否可达（见前置检查②）。

### push 失败：non-fast-forward

说明 origin 上有本地没有的 commit（比如别人直接推了 fork）。这种情况极少见——先 `git pull origin main --rebase` 再 push。

### 有未提交的修改不能 merge

`git stash` 暂存 → 同步 → `git stash pop` 恢复。如果 pop 时有冲突，手动解决。