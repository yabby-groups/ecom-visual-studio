import { ImagePlus, MoreHorizontal } from "lucide-react";
import { Link } from "react-router-dom";
import type { Project } from "../types";
import { fileUrl } from "../utils/assets";
import "./ProjectCard.css";

export function ProjectCard({ project }: { project: Project }) {
  return (
    <Link to={`/projects/${project.id}`} className="project-card">
      <div className="project-preview">
        {project.reference ? (
          <img src={fileUrl(project.reference)} alt="" />
        ) : (
          <ImagePlus size={28} />
        )}
      </div>
      <div>
        <span>{project.asset_count || 0} 个画面</span>
        <h3>{project.name}</h3>
        <p>{project.product}</p>
      </div>
      <MoreHorizontal size={18} />
    </Link>
  );
}
