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
