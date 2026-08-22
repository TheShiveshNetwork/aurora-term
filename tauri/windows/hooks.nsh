!macro NSIS_HOOK_PREINSTALL
  ; Kill Aurora main process and sidecar before installing
  nsExec::Exec 'taskkill /F /IM aurora-term.exe'
  nsExec::Exec 'taskkill /F /IM aurora-agent.exe'
  Sleep 500
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Kill processes before uninstalling
  nsExec::Exec 'taskkill /F /IM aurora-term.exe'
  nsExec::Exec 'taskkill /F /IM aurora-agent.exe'
  Sleep 500
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Register the `aurora://` URI scheme so the web companion can hand off a
  ; Supabase session to the desktop app even on a fresh install, before the app
  ; has ever been launched (the Rust side also re-registers it at runtime via
  ; `tauri_plugin_deep_link`, so this is idempotent).
  WriteRegStr HKCU "Software\Classes\aurora" "" "URL:Aurora Protocol"
  WriteRegStr HKCU "Software\Classes\aurora" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\aurora\DefaultIcon" "" "$INSTDIR\aurora-term.exe,0"
  WriteRegStr HKCU "Software\Classes\aurora\shell\open\command" "" '"$INSTDIR\aurora-term.exe" "%1"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Best-effort cleanup of the URI scheme registration.
  DeleteRegKey HKCU "Software\Classes\aurora"
!macroend
