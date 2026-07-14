import { useMemo } from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const KOLKATA_UTC_OFFSET = "+05:30";

function parseDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("Deadline date is invalid");

  const [, yearValue, monthValue, dayValue] = match;
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error("Deadline date is invalid");
  }

  return { year, month, day };
}

export function normalizeDesign2DCompletionDeadline(value: string) {
  const { year, month, day } = parseDate(value);
  const followingDay = new Date(Date.UTC(year, month - 1, day + 1));
  const date = [
    followingDay.getUTCFullYear(),
    String(followingDay.getUTCMonth() + 1).padStart(2, "0"),
    String(followingDay.getUTCDate()).padStart(2, "0"),
  ].join("-");

  return new Date(`${date}T00:00:00${KOLKATA_UTC_OFFSET}`).toISOString();
}

export function Design2DCompletionDueDatePicker({ value, onChange, disabled = false }: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const selectedDate = useMemo(() => {
    if (!value) return undefined;
    try {
      const { year, month, day } = parseDate(value);
      return new Date(year, month - 1, day);
    } catch {
      return undefined;
    }
  }, [value]);

  const label = value
    ? value.split("-").reverse().join("-")
    : "Deadline";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn("h-9 w-full justify-start px-3 text-left text-xs font-normal", !value && "text-muted-foreground")}
          disabled={disabled}
          aria-label="Deadline"
        >
          <CalendarIcon className="mr-2 h-3.5 w-3.5" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selectedDate}
          defaultMonth={selectedDate || new Date()}
          onSelect={(date) => date && onChange(format(date, "yyyy-MM-dd"))}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}
