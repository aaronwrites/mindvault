"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun, MoreHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel, DropdownMenuGroup, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { getThemePreference, setThemePreference, subscribeToTheme, type ThemePreference } from "@/lib/theme";

export function ThemeToggle({ onTrash }: { onTrash?: () => void }) {
  const preference = useSyncExternalStore(subscribeToTheme, getThemePreference, () => "system" as ThemePreference);
  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="size-11 shrink-0" aria-label="Board menu" title="Collection menu" />}><MoreHorizontal aria-hidden="true" /></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-48">
      <DropdownMenuGroup><DropdownMenuLabel>Appearance</DropdownMenuLabel>
      <DropdownMenuRadioGroup aria-label="Color theme" value={preference} onValueChange={value => { if (value === "light" || value === "dark" || value === "system") setThemePreference(value); }}>
        <DropdownMenuRadioItem value="light" className="min-h-11"><Sun aria-hidden="true" />Light</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="dark" className="min-h-11"><Moon aria-hidden="true" />Dark</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="system" className="min-h-11"><Monitor aria-hidden="true" />System</DropdownMenuRadioItem>
      </DropdownMenuRadioGroup></DropdownMenuGroup>
      {onTrash && <><DropdownMenuSeparator /><DropdownMenuItem className="min-h-11" onClick={onTrash}><Trash2 aria-hidden="true" />View Trash</DropdownMenuItem></>}
    </DropdownMenuContent>
  </DropdownMenu>;
}
