import { describe, expect, it } from 'vitest';
import { createWorkflowDefinition, getPhaseForNode, WORKFLOW_NODE_IDS } from './index';

describe('workflow definition', () => {
  it('contains ten unique backend nodes', () => {
    expect(WORKFLOW_NODE_IDS).toHaveLength(10);
    expect(new Set(WORKFLOW_NODE_IDS).size).toBe(WORKFLOW_NODE_IDS.length);
  });

  it('maps every node to exactly one of four visible phases', () => {
    const definition = createWorkflowDefinition();
    const mapped = definition.phases.flatMap((phase) => phase.nodeIds);

    expect(definition.phases).toHaveLength(4);
    expect(mapped).toHaveLength(WORKFLOW_NODE_IDS.length);
    expect(new Set(mapped)).toEqual(new Set(WORKFLOW_NODE_IDS));
  });

  it('runs mock TTS before asset matching to keep timing authoritative', () => {
    const voiceIndex = WORKFLOW_NODE_IDS.indexOf('synthesize_voice');
    const matchIndex = WORKFLOW_NODE_IDS.indexOf('match_assets');

    expect(voiceIndex).toBeGreaterThanOrEqual(0);
    expect(matchIndex).toBeGreaterThan(voiceIndex);
  });

  it('returns the phase for a node', () => {
    expect(getPhaseForNode('synthesize_voice')?.id).toBe('voice');
    expect(getPhaseForNode('save_project')?.id).toBe('video');
  });
});
