import * as React from "react"
import { store } from "@/lib/store"

const STORAGE_KEY = "gearshift.aiCommitPrompt"

export const DEFAULT_AI_COMMIT_PROMPT =
  "Review only the changes made by this agent turn, choose the correct Conventional Commit prefix, and commit only those agent-made changes. Leave any unrelated user or pre-existing changes unstaged and uncommitted. Do not push. Format the commit message with the actual commit subject on the first line, a blank line, then concise bullet points that clearly summarize what changed for a human reader."

export function loadAiCommitPrompt(): string {
  try {
    return store.get(STORAGE_KEY) || DEFAULT_AI_COMMIT_PROMPT
  } catch {
    return DEFAULT_AI_COMMIT_PROMPT
  }
}

export function saveAiCommitPrompt(prompt: string): void {
  const trimmed = prompt.trim()
  if (!trimmed || trimmed === DEFAULT_AI_COMMIT_PROMPT) {
    store.remove(STORAGE_KEY)
    return
  }
  store.set(STORAGE_KEY, trimmed)
}

export function resetAiCommitPrompt(): void {
  store.remove(STORAGE_KEY)
}

export function useAiCommitPrompt() {
  const [prompt, setPromptState] = React.useState(() => loadAiCommitPrompt())

  React.useEffect(
    () => store.onReady(() => setPromptState(loadAiCommitPrompt())),
    []
  )

  const setPrompt = React.useCallback((next: string) => {
    setPromptState(next)
    saveAiCommitPrompt(next)
  }, [])

  const resetPrompt = React.useCallback(() => {
    resetAiCommitPrompt()
    setPromptState(DEFAULT_AI_COMMIT_PROMPT)
  }, [])

  return {
    prompt,
    setPrompt,
    resetPrompt,
    isDefault: prompt.trim() === DEFAULT_AI_COMMIT_PROMPT,
  }
}
