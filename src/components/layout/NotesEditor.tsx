import { useCallback, useEffect, useRef } from "react"
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

const NOTES_SAVE_DEBOUNCE_MS = 500

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
  placeholder,
}: {
  projectId: string | null
  initialMarkdown: string
  editable: boolean
  placeholder: string
}) {
  const saveTimerRef = useRef<number | null>(null)
  const latestRef = useRef(initialMarkdown)

  const save = useCallback(
    (markdown: string) => {
      if (!projectId) return
      void window.term.notes.save(projectId, markdown).then((res) => {
        if (!res.ok) toast.error("Could not save notes")
      })
    },
    [projectId]
  )

  const flushSave = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    save(latestRef.current)
  }, [save])

  const editor = useEditor({
    editable,
    extensions: [
      ...editorExtensions,
      Placeholder.configure({ placeholder }),
    ],
    content: initialMarkdown,
    editorProps: {
      attributes: {
        class: "notes-editor focus:outline-none",
      },
    },
    onUpdate: ({ editor }) => {
      if (!editable) return
      latestRef.current = getMarkdown(editor)
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
      }
      saveTimerRef.current = window.setTimeout(
        flushSave,
        NOTES_SAVE_DEBOUNCE_MS
      )
    },
  })

  // Flush any pending save when the editor is torn down (project switch/unmount).
  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        save(latestRef.current)
      }
    }
  }, [save])

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
        onClick={() =>
          editor.chain().focus().toggleHeading({ level: 2 }).run()
        }
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
