Option Explicit

Dim shell, fso, agentPath, workingDir
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

agentPath = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "remote-ops-agent.exe")
workingDir = fso.GetParentFolderName(agentPath)

If Not fso.FileExists(agentPath) Then
  WScript.Echo "Remote Ops Agent executable was not found: " & agentPath
  WScript.Quit 1
End If

shell.CurrentDirectory = workingDir
shell.Run Chr(34) & agentPath & Chr(34), 0, False

Set fso = Nothing
Set shell = Nothing
