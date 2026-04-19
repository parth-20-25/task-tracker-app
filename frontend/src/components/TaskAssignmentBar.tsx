
import { useTasks } from '@/contexts/useTasks';
import { useAssignableUsersQuery } from '@/hooks/queries/useAssignableUsersQuery';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Priority } from '@/types';
import { Search, Plus, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from '@/hooks/use-toast';
import { useState } from 'react';

export function TaskAssignmentBar() {
  const { addTask } = useTasks();
  const assignableUsersQuery = useAssignableUsersQuery();
  const assignableUsers = assignableUsersQuery.data ?? [];
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [deadline, setDeadline] = useState('');
  const [machineName, setMachineName] = useState('');
  const [locationTag, setLocationTag] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  const filtered = assignableUsers.filter((user) =>
    user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.employee_id.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const selectedUser = assignableUsers.find((user) => user.employee_id === assignedTo);

  const handleSubmit = async () => {
    if (!description || !assignedTo || !deadline) {
      return;
    }

    try {
      await addTask({
        description,
        assigned_to: assignedTo,
        assignee_ids: [assignedTo],
        priority,
        deadline: new Date(deadline).toISOString(),
        machine_name: machineName || undefined,
        location_tag: locationTag || undefined,
      });

      setDescription('');
      setAssignedTo('');
      setPriority('medium');
      setDeadline('');
      setMachineName('');
      setLocationTag('');
      setOpen(false);
    } catch (error) {
      toast({
        title: 'Task not assigned',
        description: error instanceof Error ? error.message : 'Failed to assign task',
        variant: 'destructive',
      });
    }
  };

  return (
    <Card className="animate-fade-in">
      <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between">
        <h3 className="font-semibold text-sm">Assign New Task</h3>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(!open)}>
          {open ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        </Button>
      </CardHeader>

      {open && (
        <CardContent className="p-4 pt-2 space-y-3">
          <div className="grid md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Assign To *</Label>
              <Popover open={showSearch} onOpenChange={setShowSearch}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start h-9 text-sm font-normal">
                    <Search className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                    {selectedUser
                      ? `${selectedUser.name} (${selectedUser.employee_id})`
                      : 'Search employee...'}
                  </Button>
                </PopoverTrigger>

                <PopoverContent className="w-72 p-2" align="start">
                  <Input
                    placeholder="Search by name or ID..."
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    className="h-8 text-sm mb-2"
                  />

                  <div className="max-h-40 overflow-y-auto space-y-0.5">
                    {filtered.map((user) => (
                      <button
                        key={user.employee_id}
                        className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-accent transition-colors"
                        onClick={() => {
                          setAssignedTo(user.employee_id);
                          setShowSearch(false);
                          setSearchQuery('');
                        }}
                      >
                        <span className="font-medium">{user.name}</span>
                        <span className="text-muted-foreground ml-2 text-xs">
                          {user.employee_id}
                        </span>
                      </button>
                    ))}

                    {filtered.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-2">
                        No matches
                      </p>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Description *</Label>
            <Textarea
              placeholder="Task details..."
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
              className="text-sm"
            />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Priority</Label>
              <Select value={priority} onValueChange={(value) => setPriority(value as Priority)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Deadline *</Label>
              <Input
                type="datetime-local"
                value={deadline}
                onChange={(event) => setDeadline(event.target.value)}
                className="h-9 text-sm"
              />
            </div>

          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Machine</Label>
              <Input
                placeholder="Machine or line"
                value={machineName}
                onChange={(event) => setMachineName(event.target.value)}
                className="h-9 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Location</Label>
              <Input
                placeholder="Location tag"
                value={locationTag}
                onChange={(event) => setLocationTag(event.target.value)}
                className="h-9 text-sm"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <div className="flex items-end">
              <Button
                onClick={() => {
                  handleSubmit().catch((error) => {
                    console.error('ASSIGN TASK ERROR:', error);
                  });
                }}
                className="w-full h-9 text-sm"
                disabled={!description || !assignedTo || !deadline}
              >
                <Plus className="h-4 w-4 mr-1" />
                Assign
              </Button>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
