export type SettingsSection = "general" | "agents" | "keybindings" | "appearance"

export function parseSettingsSection(value: unknown): SettingsSection {
  return value === "agents" ||
    value === "keybindings" ||
    value === "appearance"
    ? value
    : "general"
}
