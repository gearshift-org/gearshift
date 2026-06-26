import { useCallback, useEffect, useMemo, useRef } from "react"
import { EditorContent, useEditor, type Editor } from "@tiptap/react"
import { BubbleMenu } from "@tiptap/react/menus"
import StarterKit from "@tiptap/starter-kit"
import TaskList from "@tiptap/extension-task-list"
import TaskItem from "@tiptap/extension-task-item"
import Placeholder from "@tiptap/extension-placeholder"
import { Markdown } from "tiptap-markdown"
import { toast } from "sonner"
import {
  Bold,
  Heading2,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  Strikethrough,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

const NOTES_SAVE_DEBOUNCE_MS = 200

// tiptap-markdown stashes its serializer on editor.storage but its type
// augmentation isn't picked up under TipTap v3, so read it through a narrow cast.
function getMarkdown(editor: Editor): string {
  const storage = editor.storage as {
    markdown?: { getMarkdown: () => string }
  }
  return storage.markdown?.getMarkdown() ?? ""
}

const editorExtensions = [
  StarterKit,
  TaskList,
  TaskItem.configure({ nested: true }),
  Markdown.configure({
    html: false,
    tightLists: true,
    bulletListMarker: "-",
    transformPastedText: true,
    transformCopiedText: true,
  }),
]

/**
 * Basic Notion-like notes editor (TipTap). Supports headings, bold/italic/
 * strike, bullet/ordered lists and checklists — no images. Content is stored as
 * Markdown so it stays human-readable and matches the /notes web export.
 */
export function NotesEditor({
  projectId,
  initialMarkdown,
  editable,
  onSaved,
  placeholder,
}: {
  projectId: string | null
  initialMarkdown: string
  editable: boolean
  onSaved?: (note: {
    projectId: string
    body: string
    updatedAt: number
  }) => void
  placeholder: string
}) {
  const saveTimerRef = useRef<number | null>(null)
  const editorRef = useRef<Editor | null>(null)
  const latestRef = useRef(initialMarkdown)
  const lastSavedRef = useRef(initialMarkdown)
  const dirtyRef = useRef(false)
  const saveInFlightRef = useRef(false)
  const saveQueuedRef = useRef(false)
  const saveErrorShownRef = useRef(false)
  const extensions = useMemo(
    () => [...editorExtensions, Placeholder.configure({ placeholder })],
    [placeholder]
  )

  const captureLatestMarkdown = useCallback(() => {
    const editor = editorRef.current
    if (editor) latestRef.current = getMarkdown(editor)
    return latestRef.current
  }, [])

  const runSaveLoop = useCallback(() => {
    if (!projectId) return
    if (saveInFlightRef.current) {
      saveQueuedRef.current = true
      return
    }

    saveInFlightRef.current = true

    void (async () => {
      try {
        for (;;) {
          saveQueuedRef.current = false
          const markdown = captureLatestMarkdown()
          dirtyRef.current = false
          if (markdown === lastSavedRef.current) break

          try {
            const res = await window.term.notes.save(projectId, markdown)
            if (!res.ok) {
              dirtyRef.current = true
              if (!saveErrorShownRef.current) {
                toast.error("Could not save notes")
                saveErrorShownRef.current = true
              }
              break
            }
            saveErrorShownRef.current = false
            lastSavedRef.current = markdown
            if (res.note) onSaved?.(res.note)
          } catch {
            dirtyRef.current = true
            if (!saveErrorShownRef.current) {
              toast.error("Could not save notes")
              saveErrorShownRef.current = true
            }
            break
          }

          if (!saveQueuedRef.current && latestRef.current === markdown) break
        }
      } finally {
        saveInFlightRef.current = false
      }
    })()
  }, [captureLatestMarkdown, onSaved, projectId])

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      runSaveLoop()
    }, NOTES_SAVE_DEBOUNCE_MS)
  }, [runSaveLoop])

  const scheduleDirtySave = useCallback(() => {
    if (!editable || !projectId) return
    dirtyRef.current = true
    scheduleSave()
  }, [editable, projectId, scheduleSave])

  const editor = useEditor({
    editable,
    extensions,
    content: initialMarkdown,
    editorProps: {
      attributes: {
        class: "notes-editor focus:outline-none",
      },
    },
  })

  useEffect(() => {
    editorRef.current = editor
  }, [editor])

  useEffect(() => {
    if (!editor) return
    if (initialMarkdown === lastSavedRef.current) return
    if (dirtyRef.current || latestRef.current !== lastSavedRef.current) return

    editor.commands.setContent(initialMarkdown, { emitUpdate: false })
    latestRef.current = initialMarkdown
    lastSavedRef.current = initialMarkdown
  }, [editor, initialMarkdown])

  useEffect(() => {
    if (!editor) return
    editor.on("update", scheduleDirtySave)
    return () => {
      editor.off("update", scheduleDirtySave)
    }
  }, [editor, scheduleDirtySave])

  // Save pending edits when switching projects or unmounting the notes panel.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      captureLatestMarkdown()
      if (latestRef.current !== lastSavedRef.current) {
        runSaveLoop()
      }
    }
  }, [captureLatestMarkdown, runSaveLoop])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {editable && editor ? (
        <BubbleMenu
          editor={editor}
          className="flex items-center gap-0.5 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <NotesToolbarButtons editor={editor} />
        </BubbleMenu>
      ) : null}
      <div
        className="min-h-0 flex-1 cursor-text overflow-y-auto px-3 py-2.5"
        onMouseDown={(e) => {
          // Clicking the empty area below the content focuses the editor.
          if (e.target === e.currentTarget) editor?.commands.focus("end")
        }}
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}

function NotesToolbarButtons({ editor }: { editor: Editor }) {
  return (
    <>
      <ToolbarButton
        label="Heading"
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 />
      </ToolbarButton>
      <ToolbarButton
        label="Bold"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold />
      </ToolbarButton>
      <ToolbarButton
        label="Italic"
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic />
      </ToolbarButton>
      <ToolbarButton
        label="Strikethrough"
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough />
      </ToolbarButton>
      <div className="mx-0.5 h-4 w-px bg-border/60" />
      <ToolbarButton
        label="Bullet list"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List />
      </ToolbarButton>
      <ToolbarButton
        label="Numbered list"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered />
      </ToolbarButton>
      <ToolbarButton
        label="Checklist"
        active={editor.isActive("taskList")}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
      >
        <ListChecks />
      </ToolbarButton>
    </>
  )
}

function ToolbarButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      aria-pressed={active}
      // Keep the editor selection while clicking the toolbar.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "text-muted-foreground",
        active && "bg-accent text-foreground"
      )}
    >
      {children}
    </Button>
  )
}
