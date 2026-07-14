import { FolderOpen } from "lucide-react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface ProjectFixtureSectionHeaderProps {
  headingId?: string;
  title: string;
  selectedProjectId: string;
  onProjectChange: (projectId: string) => void;
  projects: Array<{ projectId: string; label: string }>;
  ariaLabel?: string;
}

export function ProjectFixtureSectionHeader({
  headingId,
  title,
  selectedProjectId,
  onProjectChange,
  projects,
  ariaLabel,
}: ProjectFixtureSectionHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        <FolderOpen className="h-5 w-5 text-primary" />
        <h2 id={headingId} className="text-lg font-semibold">{title}</h2>
      </div>
      <Select
        value={selectedProjectId || "__none__"}
        onValueChange={(value) => onProjectChange(value === "__none__" ? "" : value)}
      >
        <SelectTrigger className="h-9 w-[260px] text-sm" aria-label={ariaLabel}>
          <SelectValue placeholder="Select a project…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">Select a project…</SelectItem>
          {projects.map((project) => (
            <SelectItem key={project.projectId} value={project.projectId}>{project.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
