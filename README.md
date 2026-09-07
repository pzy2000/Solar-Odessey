# 太阳系奥德赛 · Solar System Odyssey

真实太阳系驾驶模拟：行星位置与现实中此刻完全一致，每一处视觉来自物理公式与 NASA 真实数据。
完整计划见 [PLAN.md](./PLAN.md)。

## 快速开始

```bash
npm install
npm run fetch:textures   # 下载纹理：NASA 公有领域 + Solar System Scope CC BY 4.0（需网络，见 docs/CREDITS.md）
npm run dev              # http://localhost:5173
npm test                 # 单元测试
npm run build            # 类型检查 + 生产构建
```

## 运行模式

| URL 参数 | 内容 |
|---|---|
| `/`（默认） | M0 地球尺度验证演示 |
| `?m=m1` | 星历引擎：时间面板 + 黄道俯视图 + 全天体 RA/Dec/光行时 |
| `?m=m2` | 太阳系全家福（27 天体 + Hipparcos 星空 + 土星环 + 大气 + 小行星带） |
| `?m=m3` | 飞行模式：飞船点火 + 轨道线 + Δv 预算 + 曲速引擎 + porkchop |
| `?m=m6` | 月面着陆行走（阿波罗 11 静海，真实 LOLA 地形，G 看地出） |
| `?m=m8` | 任务重演：阿波罗 8 / 旅行者 2 / 卡西尼 |

漫游场景（m2/m3/m8）键位：拖动旋转 · 滚轮缩放 · ‹› 切换目标 · P 照片模式 · O 下载 PNG · H 帮助 · M 环境音。
验收真值门禁：`npm run verify:truth`（IMCCE INPOP）/ `verify:satellites`。

## 里程碑进度

- [x] **M0 地基** —— 真实尺度渲染 PoC（double-split + RTC 补丁 + 对数深度），见 [docs/ADR-001.md](./docs/ADR-001.md)
- [x] **M1 心跳** —— 星历引擎：八大行星 <31″、月球 <27″（vs IMCCE INPOP 真值，门槛 60″/30″）
- [x] **M2 全家福** —— 27 天体 + Hipparcos 星空 + 卫星轨道（INPOP 拟合）+ 尺度感 UI
- [x] **M3 点火** —— Kepler/Lambert/SOI/飞船/porkchop（霍曼 vs Lambert 0.0000%）
- [x] **M4 光** —— 太阳日冕/遮挡光斑 + 土星环双向阴影 + 小行星带
- [x] **M5 呼吸** —— 物理大气散射（四天体参数化）
- [x] **M6 落地** —— 真实 LOLA 月面地形 + 着陆行走 + 地出几何
- [x] **M7 跃迁** —— 超光速引擎 + 相对论星流隧道（Hipparcos 可追溯）
- [x] **M8 重演** —— 阿波罗 8 / 旅行者 2 / 卡西尼（NASA 官方时刻表）
- [x] **M9 启航** —— 帮助/照片模式/存档/环境音/打包 v1.0

## 目录

```
src/core/       时间、数学、双精度工具
src/ephemeris/  星历（M1+）
src/physics/    轨道力学（M3+）
src/render/     场景与自定义着色器
src/terrain/    地形 LOD（M0 起步：GroundPatch）
src/gameplay/   任务框架（M8）
src/ui/         HUD 与界面（M1+）
tools/          数据下载与预处理脚本
verify/         单元测试与真实数据比对脚本
docs/           ADR 决策记录、CREDITS
```
