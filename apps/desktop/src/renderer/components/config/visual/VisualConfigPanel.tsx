import { AnalysisReply } from './AnalysisReply';
import { QuickAdjustment } from './QuickAdjustment';
import { SegmentContextCard } from './SegmentContextCard';

export function VisualConfigPanel() {
  return (
    <>
      <SegmentContextCard />
      <AnalysisReply />
      <QuickAdjustment />
    </>
  );
}
