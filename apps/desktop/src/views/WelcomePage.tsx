import { useNavigate } from "react-router-dom";
import { Welcome } from "@/components/welcome/Welcome";
import { useDashboard } from "@/dashboard-context";

export function WelcomePage() {
  const navigate = useNavigate();
  const {
    projects,
    handleCreateProject,
    handleSelectProject
  } = useDashboard();

  return (
    <Welcome
      projects={projects}
      onCreateProject={handleCreateProject}
      onSelectProject={(id) => {
        void handleSelectProject(id);
        navigate(`/projects/${id}/overview`);
      }}
    />
  );
}
