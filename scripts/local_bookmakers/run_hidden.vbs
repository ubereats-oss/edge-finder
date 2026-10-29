Option Explicit
Dim shell, command, result
If WScript.Arguments.Count <> 1 Then WScript.Quit 64
Set shell = CreateObject("WScript.Shell")
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & WScript.Arguments(0) & """"
result = shell.Run(command, 0, True)
WScript.Quit result
