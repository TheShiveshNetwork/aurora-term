export type BlockStatus = 'running' | 'success' | 'error' | 'cancelled';
export type OutputType = 'plain' | 'json' | 'diff' | 'image' | 'markdown';

export interface Block {
  id: string;
  session_id: string;
  command: string;
  started_at: number;
  finished_at?: number;
  exit_code?: number;
  status: BlockStatus;
  output_type: OutputType;
  collapsed: boolean;
  ai_explain?: string;
  bookmarked: boolean;
  output_summary?: string;
  anchor_row: number;
  output_row_end: number;
  anchor_y: number;
  output_height_px?: number;
}