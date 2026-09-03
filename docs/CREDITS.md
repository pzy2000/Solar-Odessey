# 数据来源与致谢

本项目"真实感"来自以下公开数据与理论，逐项登记（M0 起维护）。

## 纹理

| 资产 | 来源 | 许可 |
|---|---|---|
| `public/textures/earth/blue_marble.jpg` | NASA Blue Marble: Next Generation — Topo-Bathy（NASA Earth Observatory / EOSGIS，eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909） | NASA 影像，公有领域（致谢 NASA） |

## 理论与算法

| 用途 | 依据 |
|---|---|
| 真实尺度渲染 | Grand Unified Scale / 仿真双精度（double-single）方法，参见 Outerra 与 Cesium 的公开技术博客 |
| 大气散射（M5，待实现） | Bruneton & Neyret; Hillaire 预计算透射/多重散射方法 |
| 星历（M1，待实现） | VSOP87 行星理论（Bretagnon & Francou）、ELP2000 月球理论（Moshier 截断实现） |
| 自转模型（M1，待实现） | IAU/WGCCRE 自转要素报告 |
