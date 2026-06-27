import { v4 as uuidv4 } from "uuid";
import { Block } from "@aurora/types";

export interface CreateBlockOptions {
  status?: Block["status"];
  outputType?: Block["output_type"];
  anchorRow?: number;
}

export function createBlock(
  sessionId: string,
  command: string,
  opts: CreateBlockOptions = {}
): Block {
  return {
    id: uuidv4(),
    session_id: sessionId,
    command,
    started_at: Date.now(),
    status: opts.status ?? "running",
    output_type: opts.outputType ?? "plain",
    collapsed: false,
    bookmarked: false,
    output_summary: "",
    anchor_row: opts.anchorRow ?? 0,
    output_row_end: opts.anchorRow ?? 0,
    anchor_y: 0,
    output_height_px: undefined,
  };
}
