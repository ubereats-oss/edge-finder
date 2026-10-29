using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

// All collection windows belong to this non-input Win32 desktop.
public static class EdgeBackgroundDesktop {
  delegate bool WindowCallback(IntPtr window, IntPtr argument);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern IntPtr CreateDesktop(string name, IntPtr device, IntPtr mode, uint flags, uint access, IntPtr security);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr OpenDesktop(string name, uint flags, bool inherit, uint access);
  [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("user32.dll")] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern bool GetUserObjectInformation(IntPtr obj, int index, StringBuilder value, int size, out int required);
  [DllImport("user32.dll")] static extern bool EnumDesktopWindows(IntPtr desktop, WindowCallback callback, IntPtr argument);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder value, int size);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup {
    public int cb; public string reserved, desktop, title;
    public int x,y,cx,cy,xChars,yChars,fill,flags; public short show,reservedBytes;
    public IntPtr reservedPointer,input,output,error;
  }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process,thread; public int pid,tid; }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool CreateProcess(string exe, StringBuilder command, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr environment, string directory, ref Startup startup, out ProcessInfo process);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  static string Quote(string value) { return "\"" + value + "\""; }
  public static bool IsInputDesktop(string name) {
    IntPtr desktop = OpenInputDesktop(0, false, 1);
    if (desktop == IntPtr.Zero) throw new InvalidOperationException("Desktop de entrada indisponível.");
    try { var value = new StringBuilder(256); int required;
      if (!GetUserObjectInformation(desktop, 2, value, 512, out required)) throw new InvalidOperationException("Desktop de entrada não identificado.");
      return String.Equals(value.ToString(), name, StringComparison.OrdinalIgnoreCase);
    } finally { CloseDesktop(desktop); }
  }
  public static IntPtr[] Windows(string desktopName, int[] owners, bool relevantOnly) {
    IntPtr desktop = OpenDesktop(desktopName, 0, false, 0x0041);
    if (desktop == IntPtr.Zero) return new IntPtr[0];
    var windows = new List<IntPtr>();
    try { EnumDesktopWindows(desktop, (window, argument) => {
      uint pid; GetWindowThreadProcessId(window, out pid);
      if (Array.IndexOf(owners, (int)pid) < 0) return true;
      var title = new StringBuilder(512); GetWindowText(window, title, title.Capacity);
      if (!relevantOnly || title.ToString() == "TunnelBear" || (IsWindowVisible(window) && title.Length > 0)) windows.Add(window);
      return true;
    }, IntPtr.Zero); } finally { CloseDesktop(desktop); }
    return windows.ToArray();
  }
  static ProcessInfo Start(string exe, string[] arguments, string desktopName, string directory, short show) {
    var startup = new Startup(); startup.cb = Marshal.SizeOf(startup);
    startup.desktop = "winsta0\\" + desktopName; startup.flags = 1; startup.show = show;
    var command = new StringBuilder(Quote(exe));
    foreach (string argument in arguments) command.Append(" ").Append(Quote(argument));
    ProcessInfo process;
    if (!CreateProcess(exe, command, IntPtr.Zero, IntPtr.Zero, false, 0x08000000, IntPtr.Zero, directory, ref startup, out process)) throw new System.ComponentModel.Win32Exception();
    CloseHandle(process.thread); return process;
  }
  public static int StartApplication(string exe, string desktopName) {
    ProcessInfo process = Start(exe, new string[0], desktopName, System.IO.Path.GetDirectoryName(exe), 1);
    CloseHandle(process.process); return process.pid;
  }
  public static int Run(string exe, string[] arguments, string desktopName, string directory, string pidFile) {
    ProcessInfo process = Start(exe, arguments, desktopName, directory, 0);
    System.IO.File.WriteAllText(pidFile, process.pid.ToString());
    try {
      // Existing collector and Scheduler limits remain responsible for execution.
      if (WaitForSingleObject(process.process, 0xffffffff) != 0) throw new InvalidOperationException("Não foi possível aguardar o coletor.");
      uint code; if (!GetExitCodeProcess(process.process, out code)) throw new InvalidOperationException("Resultado do coletor indisponível.");
      return (int)code;
    } finally { CloseHandle(process.process); }
  }
}
