# 数据来源与致谢

本项目"真实感"来自以下公开数据与理论，逐项登记（M0 起维护）。

## 纹理

| 资产 | 来源 | 许可 |
|---|---|---|
| `public/textures/earth/blue_marble.jpg` | NASA Blue Marble: Next Generation — Topo-Bathy（NASA Earth Observatory，eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909） | NASA 影像，公有领域（致谢 NASA） |
| `public/textures/planets/*.jpg`（水金火木土天海月）与 `sky/milky_way.jpg` | Solar System Scope Textures（基于 NASA 影像/高程数据制作），solarsystemscope.com/textures | CC BY 4.0 |
| `public/textures/planets/saturn_ring_alpha.png` | Solar System Scope Textures | CC BY 4.0 |

## 星表与轨道数据

| 资产 | 来源 | 许可/说明 |
|---|---|---|
| `src/ephemeris/data/stars.json` | Hipparcos 主星表（ESA 1997），经 CDS VizieR（I/239）获取，Vmag < 7.5 共 25,493 颗 | Hipparcos 数据使用请致谢 ESA Hipparcos 任务 |
| `src/ephemeris/data/ephemeris.json` | VSOP87 行星理论完整序列（Bretagnon & Francou, IMCCE）与 Meeus《Astronomical Algorithms》月球周期项表，经 PyMeeus 项目数据文件转换（仅取数据，未复制代码） | VSOP87 学术使用自由；PyMeeus LGPL-3.0 |
| `src/ephemeris/data/satellites.json` | 16 颗主要卫星平均轨道要素，由 IMCCE Miriade Web 服务（INPOP19 星历）位置序列拟合而来 | INPOP：IMCCE/Observatoire de Paris；使用请致谢 |

## 在线验证服务

| 服务 | 用途 |
|---|---|
| IMCCE Miriade ephemcc（ssp.imcce.fr） | M1/M2 真值验收网关（INPOP19 星历） |
| JPL Horizons（ssd.jpl.nasa.gov） | 备用真值网关（本网络环境不可达时跳过，`npm run verify:horizons`） |

## 理论与算法

| 用途 | 依据 |
|---|---|
| 真实尺度渲染 | Grand Unified Scale / 仿真双精度方法（Outerra、Cesium 公开技术博客）；多天体场景采用相机相对 f32 定位（见 ADR-001） |
| 大气散射（M5，待实现） | Bruneton & Neyret; Hillaire 预计算透射/多重散射方法 |
| 星历 | VSOP87（Bretagnon & Francou）、ELP2000/Meeus ch.47、Meeus ch.41（冥王星） |
| 自转模型 | IAU/WGCCRE 2009 报告（Archinal et al. 2011） |
