Option Explicit
Dim fs, shell, root, helper, script, command, environment
Set fs = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
Set environment = shell.Environment("Process")
environment.Remove "PSModulePath"
root = fs.GetParentFolderName(WScript.ScriptFullName)
helper = fs.BuildPath(root, "helper")
If Not fs.FileExists(fs.BuildPath(helper, "launch.ps1")) Then helper = root
script = fs.BuildPath(helper, "launch.ps1")
If Not fs.FileExists(script) Then
  MsgBox "Together launcher files are missing.", 16, "inZOI Together"
  WScript.Quit 1
End If
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & script & Chr(34)
shell.Run command, 0, False
