import * as React from "react"
import { store } from "@/lib/store"

const STORAGE_KEY = "gearshift.aiCommitPrompt"

export const DEFAULT_AI_COMMIT_PROMPT =
  "Review the changes, choose the correct Conventional Commit prefix, write the commit message, and commit only the staged changes. Do not push."

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
