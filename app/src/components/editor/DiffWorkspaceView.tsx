import { DiffEditor } from "./DiffEditor";

interface DiffWorkspaceViewProps {
  filePath: string;
  oldContent: string;
  newContent: string;
  commitHash: string;
}

// No wrapper div — DiffEditor owns its own dimensions.
// Any ancestor wrapper breaks height propagation.
export function DiffWorkspaceView({
  filePath,
  oldContent,
  newContent,
  commitHash,
}: DiffWorkspaceViewProps) {
  const fileName = filePath.split(/[/\\]/).pop() || filePath;
  return (
    <DiffEditor
      filePath={filePath}
      oldContent={oldContent}
      newContent={newContent}
      oldLabel={`${commitHash.slice(0, 7)}~1 — ${fileName}`}
      newLabel={`${commitHash.slice(0, 7)} — ${fileName}`}
      commitHash={commitHash}
    />
  );
}