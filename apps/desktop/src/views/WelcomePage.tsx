import { useNavigate } from "react-router-dom";
import { Welcome } from "@/components/welcome/Welcome";
import { useDashboard } from "@/dashboard-context";

export function WelcomePage() {
  const navigate = useNavigate();
  const {
    projects,
    handleCreateProject,
    handleSelectProject,
    health,
    actions,
    settings,
    setSettingsOpen,
    handleConnectBlender,
    sidecarUrl,
  } = useDashboard();

  return (
    <Welcome
      projects={projects}
      onCreateProject={handleCreateProject}
      onSelectProject={(id) => {
        void handleSelectProject(id);
        navigate(`/projects/${id}/overview`);
      }}
      sidecarConnected={Boolean(health?.ok)}
      blenderConnected={Boolean(health?.blender?.connected)}
      blenderConnecting={actions.connect}
      groqConfigured={(settings.groqApiKey ?? "").length > 0}
      openRouterConfigured={(settings.openRouterApiKey ?? "").length > 0}
      onOpenSettings={() => setSettingsOpen(true)}
      onConnectBlender={() => void handleConnectBlender()}
      sidecarUrl={sidecarUrl}
    />
  );
}
