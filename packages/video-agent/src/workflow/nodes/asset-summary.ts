import type { AnalyzedAssetCollection } from '@miaoma/video-project';

export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1_000));

  if (totalSeconds < 60) {
    return `${totalSeconds} 秒`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return seconds === 0 ? `${minutes} 分钟` : `${minutes} 分 ${seconds} 秒`;
}

/**
 * 给提示词用的素材摘要：只包含 assetId、技术描述和标签，
 * 不包含绝对路径、文件名中的完整目录或任何密钥。
 */
export function summarizeAnalyzedAssets(collection: AnalyzedAssetCollection): string {
  if (collection.assets.length === 0) {
    return '当前没有可用的画面素材。请不要虚构素材；在 coverageIssues 中明确说明缺少素材。';
  }

  const totalDurationMs = collection.assets.reduce((total, asset) => total + asset.durationMs, 0);
  const tagCounts = new Map<string, number>();

  for (const asset of collection.assets) {
    for (const tag of asset.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  const tagSummary = [...tagCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 12)
    .map(([tag, count]) => `${tag}(${count})`)
    .join('、');

  const assetLines = collection.assets
    .slice(0, 30)
    .map((asset) => `- ${asset.assetId}：${asset.description}`)
    .join('\n');

  const failureLines =
    collection.failures.length > 0
      ? `\n分析失败/跳过 ${collection.failures.length} 个素材：${collection.failures
          .slice(0, 5)
          .map((failure) => failure.message)
          .join('；')}`
      : '';

  return (
    [
      `可用画面素材 ${collection.assets.length} 个，总时长 ${formatDuration(totalDurationMs)}。`,
      tagSummary ? `主要标签：${tagSummary}` : '',
      assetLines,
    ]
      .filter(Boolean)
      .join('\n') + failureLines
  );
}
