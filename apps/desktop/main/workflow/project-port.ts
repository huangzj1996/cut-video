import type { ProjectPort } from '@miaoma/video-agent/workflow';
import type { ProjectStore } from '../projects/project-store';

export function createDesktopProjectPort(getStore: () => ProjectStore): ProjectPort {
  return {
    getDirectory: (projectId) => getStore().getProjectDirectory(projectId),
    read: (projectId) => getStore().get(projectId),
    readCreationInput: (projectId) => getStore().readCreationInput(projectId),
    replaceAssets: (projectId, assets) => getStore().replaceAssets(projectId, assets),
    save: (projectId, project, expectedRevision) =>
      getStore().saveGeneratedProject(projectId, project, expectedRevision),
  };
}
