export type GenerationEvent = {
  id: number
  type: "delta" | "done" | "error" | "stopped"
  data: Record<string, unknown>
}

export type GenerationUpdate = {
  content: string
  status: "streaming" | "completed" | "stopped" | "failed"
  lastEventId: number
}
