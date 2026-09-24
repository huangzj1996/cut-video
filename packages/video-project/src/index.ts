export const PROJECT_SCHEMA_VERSION = 1;

export interface VideoAsset {
  id: string;
  name: string;
  path: string;
}

export interface VideoProject {
  id: string;
  name: string;
  assets: VideoAsset[];
}
