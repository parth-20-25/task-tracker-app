import { useEffect, useMemo, useState, type ComponentProps } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3 } from "lucide-react";
import {
  fetchPendingProjectPlanning,
  fetchProjectPlannedTime,
  saveProjectPlannedTime,
  type PlannedStage,
  type PlannedUnit,
  type ProjectPlanningData,
} from "@/api/projectScopeApi";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/useAuth";
import { toast } from "@/hooks/use-toast";
import { PLANNED_STAGES, PLANNED_STAGE_LABELS, planningStagesForUser } from "@/lib/projectScope";

export interface PlannedTimeDraft {
  unit: PlannedUnit;
  values: Partial<Record<PlannedStage, string>>;
}

function displayValue(hours: number | null, unit: PlannedUnit, hoursPerDay: number) {
  if (hours === null) return "";
  const value = unit === "DAYS" ? hours / hoursPerDay : hours;
  return Number(value.toFixed(4)).toString();
}

function convertValues(
  values: Partial<Record<PlannedStage, string>>,
  from: PlannedUnit,
  to: PlannedUnit,
  hoursPerDay: number,
) {
  if (from === to) return values;
  return Object.fromEntries(Object.entries(values).map(([stage, raw]) => {
    if (raw === "" || raw === undefined) return [stage, ""];
    const value = Number(raw);
    return [stage, Number((to === "DAYS" ? value / hoursPerDay : value * hoursPerDay).toFixed(4)).toString()];
  })) as Partial<Record<PlannedStage, string>>;
}

function validateValues(values: Partial<Record<PlannedStage, string>>, stages: PlannedStage[]) {
  return stages.every((stage) => values[stage] === "" || values[stage] === undefined || (Number.isFinite(Number(values[stage])) && Number(values[stage]) >= 0));
}

function StageInputs({
  values,
  editableStages,
  disabled,
  onChange,
}: {
  values: Partial<Record<PlannedStage, string>>;
  editableStages: PlannedStage[];
  disabled?: boolean;
  onChange: (stage: PlannedStage, value: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {PLANNED_STAGES.map((stage) => (
        <div key={stage} className="space-y-1">
          <Label className="text-[11px] font-semibold">{PLANNED_STAGE_LABELS[stage]}</Label>
          <Input
            aria-label={PLANNED_STAGE_LABELS[stage]}
            type="number"
            min={0}
            step="any"
            value={values[stage] ?? ""}
            readOnly={!editableStages.includes(stage)}
            disabled={disabled}
            onChange={(event) => onChange(stage, event.target.value)}
            className="h-8 text-xs"
          />
        </div>
      ))}
    </div>
  );
}

export function PlannedTimeEditor({
  open,
  onOpenChange,
  projectId,
  projectNo,
  projectName,
  draft,
  onDraftChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: string | null;
  projectNo: string;
  projectName: string;
  draft?: PlannedTimeDraft | null;
  onDraftChange?: (draft: PlannedTimeDraft) => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const localEditableStages = useMemo(() => planningStagesForUser(user), [user]);
  const planningQuery = useQuery({
    queryKey: ["project-planning", projectId],
    queryFn: () => fetchProjectPlannedTime(projectId as string),
    enabled: open && Boolean(projectId),
    refetchOnWindowFocus: false,
  });
  const settingsQuery = useQuery({
    queryKey: ["project-planning", "pending"],
    queryFn: fetchPendingProjectPlanning,
    enabled: open && !projectId && localEditableStages.length > 0,
    refetchOnWindowFocus: false,
  });
  const [unit, setUnit] = useState<PlannedUnit>(draft?.unit || "HOURS");
  const [values, setValues] = useState<Partial<Record<PlannedStage, string>>>(draft?.values || {});
  const data = planningQuery.data;
  const hoursPerDay = data?.working_hours_per_day || settingsQuery.data?.working_hours_per_day || 1;
  const editableStages = projectId ? (data?.editable_stages || []) : localEditableStages;

  useEffect(() => {
    if (!open) return;
    if (data) {
      setUnit("HOURS");
      setValues(Object.fromEntries(PLANNED_STAGES.map((stage) => [stage, displayValue(data.stages[stage].normalized_hours, "HOURS", data.working_hours_per_day)])));
    } else if (!projectId) {
      setUnit(draft?.unit || "HOURS");
      setValues(draft?.values || {});
    }
  }, [data, draft, open, projectId]);

  const mutation = useMutation({
    mutationFn: () => saveProjectPlannedTime(projectId as string, {
      unit,
      stages: Object.fromEntries(editableStages.map((stage) => [stage, {
        value: values[stage] === "" || values[stage] === undefined ? null : Number(values[stage]),
        version: data?.stages[stage].version || 0,
      }])),
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["project-planning"] }),
        queryClient.invalidateQueries({ queryKey: ["project-scope"] }),
      ]);
      toast({ title: "Planned time saved" });
      onOpenChange(false);
    },
    onError: (error) => toast({ title: "Planned time not saved", description: error instanceof Error ? error.message : "Save failed", variant: "destructive" }),
  });

  const save = () => {
    if (!validateValues(values, editableStages)) {
      toast({ title: "Invalid planned time", description: "Use blank, zero, or a positive finite number.", variant: "destructive" });
      return;
    }
    if (!projectId) {
      onDraftChange?.({ unit, values });
      onOpenChange(false);
      return;
    }
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle className="text-base">Planned Time</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-medium">{projectNo || "New project"} · {projectName || "Project name pending"}</span>
            <Select value={unit} disabled={settingsQuery.isLoading || planningQuery.isLoading} onValueChange={(next: PlannedUnit) => { setValues((current) => convertValues(current, unit, next, hoursPerDay)); setUnit(next); }}>
              <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="HOURS">Hours</SelectItem><SelectItem value="DAYS">Days</SelectItem></SelectContent>
            </Select>
          </div>
          {planningQuery.isError ? <p className="text-xs text-destructive">{planningQuery.error instanceof Error ? planningQuery.error.message : "Planned time is unavailable."}</p> : null}
          <StageInputs values={values} editableStages={editableStages} disabled={planningQuery.isLoading || mutation.isPending} onChange={(stage, value) => setValues((current) => ({ ...current, [stage]: value }))} />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={save} disabled={editableStages.length === 0 || mutation.isPending}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PlannedTimeButton(props: Omit<ComponentProps<typeof PlannedTimeEditor>, "open" | "onOpenChange">) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => setOpen(true)}>
        <Clock3 className="mr-1.5 h-3.5 w-3.5" /> Planned Time
      </Button>
      <PlannedTimeEditor {...props} open={open} onOpenChange={setOpen} />
    </>
  );
}

export function PlannedTimeLoginPopup() {
  const { access, user } = useAuth();
  const queryClient = useQueryClient();
  const canPlan = access.canEditProjectPlannedTime && planningStagesForUser(user).length > 0;
  const query = useQuery({
    queryKey: ["project-planning", "pending"],
    queryFn: fetchPendingProjectPlanning,
    enabled: canPlan,
    refetchOnWindowFocus: false,
  });
  const [dismissed, setDismissed] = useState(false);
  const [unit, setUnit] = useState<PlannedUnit>("HOURS");
  const [values, setValues] = useState<Record<string, Partial<Record<PlannedStage, string>>>>({});
  const data = query.data;

  useEffect(() => {
    if (!data) return;
    setUnit("HOURS");
    setValues(Object.fromEntries(data.projects.map((project) => [project.project_id, Object.fromEntries(PLANNED_STAGES.map((stage) => [stage, displayValue(project.stages[stage].normalized_hours, "HOURS", data.working_hours_per_day)]))])));
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!data) return;
      for (const project of data.projects) {
        const projectValues = values[project.project_id] || {};
        if (!validateValues(projectValues, data.editable_stages)) throw new Error(`Invalid planned time for ${project.project_no}`);
        await saveProjectPlannedTime(project.project_id, {
          unit,
          stages: Object.fromEntries(data.editable_stages.map((stage) => [stage, {
            value: projectValues[stage] === "" || projectValues[stage] === undefined ? null : Number(projectValues[stage]),
            version: project.stages[stage].version,
          }])),
        });
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["project-planning"] }),
        queryClient.invalidateQueries({ queryKey: ["project-scope"] }),
      ]);
      setDismissed(true);
      toast({ title: "Planned time saved" });
    },
    onError: (error) => toast({ title: "Planned time not saved", description: error instanceof Error ? error.message : "Save failed", variant: "destructive" }),
  });

  const open = Boolean(data?.projects.length) && !dismissed;
  if (!canPlan) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) setDismissed(true); }}>
      <DialogContent className="max-w-4xl">
        <DialogHeader><DialogTitle className="text-base">Planned Time</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="flex justify-end">
            <Select value={unit} onValueChange={(next: PlannedUnit) => {
              if (!data) return;
              setValues((current) => Object.fromEntries(Object.entries(current).map(([projectId, projectValues]) => [projectId, convertValues(projectValues, unit, next, data.working_hours_per_day)])));
              setUnit(next);
            }}>
              <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="HOURS">Hours</SelectItem><SelectItem value="DAYS">Days</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="max-h-[55vh] overflow-auto border">
            <table className="w-full min-w-[720px] table-fixed border-collapse text-xs">
              <thead className="sticky top-0 bg-slate-100"><tr><th className="w-64 border p-1.5 text-left">Project</th>{PLANNED_STAGES.map((stage) => <th key={stage} className="border p-1.5">{PLANNED_STAGE_LABELS[stage]}</th>)}</tr></thead>
              <tbody>{data?.projects.map((project) => <tr key={project.project_id}><td className="border p-1.5 font-medium">{project.project_no} · {project.project_name}</td>{PLANNED_STAGES.map((stage) => <td key={stage} className="border p-1"><Input aria-label={`${project.project_no} ${PLANNED_STAGE_LABELS[stage]}`} type="number" min={0} step="any" className="h-7 text-xs" value={values[project.project_id]?.[stage] ?? ""} readOnly={!data.editable_stages.includes(stage)} onChange={(event) => setValues((current) => ({ ...current, [project.project_id]: { ...current[project.project_id], [stage]: event.target.value } }))} /></td>)}</tr>)}</tbody>
            </table>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setDismissed(true)}>Later</Button>
          <Button type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}