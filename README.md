# 太阳系奥德赛 · Solar System Odyssey

真实太阳系驾驶模拟：行星位置与现实中此刻完全一致，每一处视觉来自物理公式与 NASA 真实数据。
完整计划见 [PLAN.md](./PLAN.md)。

## 快速开始

```bash
npm install
npm run fetch:textures   # 下载 NASA 公有领域纹理（需网络）
npm run dev              # http://localhost:5173
npm test                 # 单元测试
npm run build            # 类型检查 + 生产构建
```

操作（M0 演示）：拖动旋转 · 滚轮对数缩放（42,000 km ↔ 100 m）· G 切换 50 m 精度网格。

## 里程碑进度

- [x] **M0 地基** —— 真实尺度渲染 PoC（double-split + RTC 补丁 + 对数深度），见 [docs/ADR-001.md](./docs/ADR-001.md)
- [ ] M1 心跳 —— 星历引擎（VSOP87/ELP2000 + JPL Horizons 验收）
- [ ] M2 全家福 —— 完整太阳系与真实星空
- [ ] M3 点火 —— 飞船与轨道力学
- [ ] M4 光 —— 太阳·环·光影
- [ ] M5 呼吸 —— 物理大气散射
- [ ] M6 落地 —— 月球/火星真实地形
- [ ] M7 跃迁 —— 超光速引擎（亚光速相对论渲染 + 蓝移隧道）
- [ ] M8 重演 —— 三大历史任务
- [ ] M9 启航 —— 打磨与 v1.0

## 目录

```
src/core/       时间、数学、双精度工具
src/ephemeris/  星历（M1+）
src/physics/    轨道力学（M3+）
src/render/     场景与自定义着色器
src/terrain/    地形 LOD（M0 起步：GroundPatch）
src/gameplay/   相机、输入、任务框架（M3+）
src/ui/         HUD 与界面（M2+）
tools/          数据下载与预处理脚本
verify/         单元测试与真实数据比对脚本
docs/           ADR 决策记录、CREDITS
```
