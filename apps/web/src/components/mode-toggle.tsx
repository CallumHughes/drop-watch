"use client";

import { Button } from "@drop-watch/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@drop-watch/ui/components/dropdown-menu";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback } from "react";

export function ModeToggle() {
  const { setTheme } = useTheme();

  const setLight = useCallback(() => setTheme("light"), [setTheme]);
  const setDark = useCallback(() => setTheme("dark"), [setTheme]);
  const setSystem = useCallback(() => setTheme("system"), [setTheme]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="icon" variant="outline" />}>
        <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
        <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        <span className="sr-only">Toggle theme</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={setLight}>Light</DropdownMenuItem>
        <DropdownMenuItem onClick={setDark}>Dark</DropdownMenuItem>
        <DropdownMenuItem onClick={setSystem}>System</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
