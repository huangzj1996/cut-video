import {
  ApprovalResultSchema,
  type ApprovalDecision,
  type ApprovalGate,
  type ApprovalResult,
  type ArtifactReference,
} from '@miaoma/video-project';
import type { NodeContext } from '../types';

export function approvalIdFor(
  gate: ApprovalGate,
  artifact: ArtifactReference,
  decision: ApprovalDecision,
): string {
  return `${gate}-${artifact.version}-${artifact.contentFingerprint.slice(0, 12)}-${decision.decision}`;
}

export async function writeApprovalResult(
  ctx: NodeContext,
  input: {
    gate: ApprovalGate;
    decision: ApprovalDecision;
    artifact: ArtifactReference;
  },
): Promise<{ reference: ArtifactReference; result: ApprovalResult }> {
  const approvalId = approvalIdFor(input.gate, input.artifact, input.decision);
  const result = ApprovalResultSchema.parse({
    schemaVersion: '1.0.0',
    approvalId,
    gate: input.gate,
    decision: input.decision.decision,
    artifact: input.artifact,
    runId: ctx.runId,
    ...(input.decision.decision === 'request_changes' ? { feedback: input.decision.feedback } : {}),
    ...(input.decision.rawText !== undefined ? { rawText: input.decision.rawText } : {}),
    approvedAt: ctx.now().toISOString(),
  });
  const reference = await ctx.writeArtifact({
    kind: 'approval',
    data: result,
    schema: ApprovalResultSchema,
    fileName: `analysis/approvals/${approvalId}.json`,
    version: input.artifact.version,
    cacheKey: approvalId,
  });

  return { reference, result };
}
