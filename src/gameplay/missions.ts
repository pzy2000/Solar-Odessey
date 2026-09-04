/**
 * M8 · 历史任务重演框架。
 * 任务 = 时间起点 + 关键事件时间线（NASA 官方记录）+ 相机预设。
 * 开始任务即把世界时间拨到历史时刻——行星排列自动就是当年的排列（星历引擎免费赠送）。
 */
export interface MissionEvent {
  /** ISO UTC */
  t: string;
  title: string;
  text: string;
  /** 相机预设：目标天体 + 距离（m） */
  target?: string;
  distM?: number;
}

export interface MissionDef {
  id: string;
  name: string;
  subtitle: string;
  startDate: string;
  events: MissionEvent[];
}

export const MISSIONS: MissionDef[] = [
  {
    id: "apollo8",
    name: "阿波罗 8",
    subtitle: "1968 · 人类首次离开地球引力场，绕月飞行",
    startDate: "1968-12-21T12:51:00Z",
    events: [
      {
        t: "1968-12-21T15:41:00Z",
        title: "TLI — 地月转移入射点火",
        text: "土星五号第三级在肯尼迪航天中心点火，阿波罗 8 成为离开地球引力场的第一批人类。",
        target: "earth",
        distM: 4.2e7,
      },
      {
        t: "1968-12-24T09:59:17Z",
        title: "LOI-1 — 月球轨道入射",
        text: "SPS 发动机在月球背面点火 246 秒，阿波罗 8 进入近月点 110 km 的环月轨道。",
        target: "moon",
        distM: 6e6,
      },
      {
        t: "1968-12-24T16:37:00Z",
        title: "地出 — 人类第一次在月面之上看见地球升起",
        text: "乘组在环月轨道第 4 圈看见了蓝色地球从月平线升起，比尔·安德斯拍下了《地出》——被称为史上最有影响力的环境照片。",
        target: "moon",
        distM: 3e6,
      },
      {
        t: "1968-12-27T15:49:00Z",
        title: "溅落太平洋",
        text: "指令舱在夏威夷西南溅落，任务圆满成功。《创世记》的朗读传遍了圣诞夜的地球。",
      },
    ],
  },
  {
    id: "voyager2",
    name: "旅行者 2 号大巡游",
    subtitle: "1977–1989 · 一次行星排列造就的连续造访四颗巨行星之旅",
    startDate: "1977-08-20T14:29:00Z",
    events: [
      {
        t: "1979-07-09T03:00:00Z",
        title: "木星系统飞掠",
        text: "旅行者 2 号距木星云顶 71.5 万公里，发现了木卫一上的活火山——太阳系中已知唯一的地球之外火山活动。",
        target: "jupiter",
        distM: 8e8,
      },
      {
        t: "1981-08-25T03:24:00Z",
        title: "土星系统飞掠",
        text: "借助土星引力弹弓继续飞向天王星——只有每 176 年一次的行星排列才能实现的航线。",
        target: "saturn",
        distM: 1.5e9,
      },
      {
        t: "1986-01-24T17:59:00Z",
        title: "天王星飞掠",
        text: "人类唯一一次近距离访问天王星：发现了 10 颗新卫星和倾斜 98° 的磁场。",
        target: "uranus",
        distM: 5e8,
      },
      {
        t: "1989-08-25T03:56:00Z",
        title: "海王星飞掠 — 大巡游终点",
        text: "距海王星北极 4,950 公里掠过，大暗斑、海卫一的间歇泉被永远记录。此后旅行者 2 号驶向星际空间。",
        target: "neptune",
        distM: 6e8,
      },
    ],
  },
  {
    id: "cassini",
    name: "卡西尼号终章",
    subtitle: "2017 · Grand Finale 与壮丽坠落",
    startDate: "2017-04-26T06:00:00Z",
    events: [
      {
        t: "2017-04-26T09:00:00Z",
        title: "首次穿越土星环缝",
        text: "卡西尼号以 12 万 km/h 从土星与主环之间穿过——此前从未有航天器进入这一区域。",
        target: "saturn",
        distM: 2.5e8,
      },
      {
        t: "2017-09-15T10:00:00Z",
        title: "最后深潜",
        text: "最后一次掠过土卫六的引力牵引把卡西尼号推上了不归路。",
        target: "saturn",
        distM: 1.5e8,
      },
      {
        t: "2017-09-15T11:54:00Z",
        title: "坠入土星大气",
        text: "姿态推进器满功率对抗大气摩擦 91 秒后失联。卡西尼号化作土星上的一颗流星——以自毁保护可能存在生命的土卫二和土卫六。",
        target: "saturn",
        distM: 1.2e8,
      },
    ],
  },
];

export function jdFromISO(iso: string): number {
  return Date.parse(iso.replace(" ", "T").replace(/Z$/, "") + (iso.endsWith("Z") ? "" : "Z")) / 86400000 + 2440587.5;
}

export function missionStartJD(m: MissionDef): number {
  return jdFromISO(m.startDate);
}

export function eventJD(e: MissionEvent): number {
  return jdFromISO(e.t);
}
