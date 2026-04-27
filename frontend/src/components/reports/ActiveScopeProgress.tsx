import { Layers3 } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export interface ActiveScopeProgressItem {
  project_key: string;
  project_no: string;
  project_name: string;
  customer_name: string;
  department_name: string;
  scope_name: string;
  fixture_no?: string | null;
  instances_complete: number;
  total_instances: number;
}

interface ActiveScopeProgressProps {
  items: ActiveScopeProgressItem[];
}

function formatProjectFixtureLabel(projectNo: string, fixtureNo?: string | null) {
  const normalizedProjectNo = String(projectNo || "").trim();
  const normalizedFixtureNo = String(fixtureNo || "").trim();

  if (!normalizedFixtureNo) {
    return normalizedProjectNo;
  }

  return `${normalizedProjectNo} - ${normalizedFixtureNo}`;
}

export function ActiveScopeProgress({ items }: ActiveScopeProgressProps) {
  const groupedItems = items.reduce<Map<string, ActiveScopeProgressItem[]>>((groups, item) => {
    const existingItems = groups.get(item.project_key) || [];
    existingItems.push(item);
    groups.set(item.project_key, existingItems);
    return groups;
  }, new Map());

  const projectGroups = [...groupedItems.entries()].map(([, projectItems]) => ({
    project: projectItems[0],
    items: projectItems,
  }));

  return (
    <Card className="md:col-span-3">
      <CardHeader className="p-4 pb-2">
        <div className="flex items-center gap-2">
          <Layers3 className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Active Scope Progress</h2>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-2">
        {projectGroups.length === 0 ? (
          <p className="text-sm text-muted-foreground">All tracked scopes are complete.</p>
        ) : (
          projectGroups.map(({ project, items: projectItems }) => {
            const totalInstances = projectItems.reduce((sum, item) => sum + item.total_instances, 0);
            const completedInstances = projectItems.reduce((sum, item) => sum + item.instances_complete, 0);

            return (
              <div key={project.project_key} className="rounded-lg border p-4">
                <div className="space-y-1">
                  <p className="font-medium">
                    {project.project_no}
                    {project.project_name ? ` · ${project.project_name}` : ""}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {project.department_name}
                    {project.customer_name ? ` · ${project.customer_name}` : ""}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {completedInstances}/{totalInstances} instances complete
                  </p>
                </div>

                <div className="mt-4 space-y-2">
                  {projectItems.map((item) => (
                    <div key={`${item.project_key}-${item.scope_name}-${item.fixture_no || "project"}`} className="rounded-md bg-muted/40 px-3 py-2 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-0.5">
                          <p className="font-medium">
                            {formatProjectFixtureLabel(item.project_no, item.fixture_no) || "Project"}
                          </p>
                          <p className="text-muted-foreground">{item.scope_name || "Scope"}</p>
                        </div>
                        <span className="shrink-0 text-muted-foreground">
                          {item.instances_complete}/{item.total_instances} instances complete
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
