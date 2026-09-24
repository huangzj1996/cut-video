export const VIDEO_AGENT_AVAILABLE = false;

export interface VideoAgentRequest {
  projectId: string;
  instruction: string;
}

export interface VideoAgent {
  run(request: VideoAgentRequest): Promise<void>;
}

export function createVideoAgent(): VideoAgent {
  return {
    async run(_request) {
      throw new Error('Video agent is not configured.');
    },
  };
}
