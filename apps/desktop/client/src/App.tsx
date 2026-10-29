import { useEffect, useState } from 'react';
import { isValidProjectId, parseEditorRoute, WORKSPACE_HASH } from './lib/routes';
import { CreateChatScreen } from './screens/CreateChatScreen';
import { EditorUnavailable } from './screens/editor-video/EditorStates';
import { EditorVideoScreen } from './screens/EditorVideoScreen';
import { HomeScreen } from './screens/HomeScreen';
import { LlmTestScreen } from './screens/LlmTestScreen';

function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash);

  useEffect(() => {
    const handleHashChange = () => {
      setHash(window.location.hash);
    };

    window.addEventListener('hashchange', handleHashChange);

    return () => {
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []);

  return hash;
}

function App() {
  const hash = useHashRoute();
  const editorRoute = parseEditorRoute(hash);

  if (editorRoute.kind === 'editor') {
    return <EditorVideoScreen key={editorRoute.projectId} projectId={editorRoute.projectId} />;
  }

  if (editorRoute.kind === 'invalid') {
    return <EditorUnavailable message="工程地址无效，请从工作台重新打开工程。" />;
  }

  if (hash === WORKSPACE_HASH) {
    return <HomeScreen activeTab="projects" />;
  }

  if (hash === '#/create') {
    return <HomeScreen activeTab="create" />;
  }

  if (hash === '#/create-chat') {
    return <CreateChatScreen />;
  }

  if (hash.startsWith('#/create-chat/')) {
    const projectId = hash.slice('#/create-chat/'.length);

    if (isValidProjectId(projectId)) {
      return <CreateChatScreen projectId={projectId} />;
    }
  }

  if (hash === '#/llm-test') {
    return <LlmTestScreen />;
  }

  return <HomeScreen activeTab="create" />;
}

export default App;
