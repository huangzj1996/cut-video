import type { Scene } from '../types/scene';

export const SCENES: readonly Scene[] = [
  { id: 1, time: '00:00-00:04', lines: ['开场把原始素材拖入时间线，', '系统开始识别画面节奏。'] },
  { id: 2, time: '00:04-00:08', lines: ['AI 自动挑选高光片段，', '同步生成第一版字幕。'] },
  { id: 3, time: '00:00-00:04', lines: ['是的发送到asdfasdfasdf', '阿斯顿发送到发的阿'] },
  { id: 4, time: '00:00-00:04', lines: ['是的发送到', '官方去潍坊过去问', '是的发送到发的岗位工区'] },
  { id: 5, time: '00:00-00:04', lines: ['阿斯顿发的', '刚刚我去二', '撒旦法水电费赶过去'] },
  { id: 6, time: '00:00-00:04', lines: ['谁的法谁的规'] },
];

export const INITIAL_SCENE_ID = 2;
