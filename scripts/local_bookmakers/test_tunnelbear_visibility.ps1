# Real Win32 regression in a disposable non-input desktop, without TunnelBear/VPN.
$ErrorActionPreference='Stop'
Add-Type -Path (Join-Path $PSScriptRoot 'background_desktop.cs')
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
public sealed class VisibilityFixture : IDisposable {
  [DllImport("user32.dll")] static extern bool SetThreadDesktop(IntPtr d);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateWindowEx(uint e,string c,string t,uint s,int x,int y,int w,int h,IntPtr p,IntPtr m,IntPtr i,IntPtr a);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr w,int command);
  [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr w);
  [StructLayout(LayoutKind.Sequential)] struct Message {public IntPtr window;public uint message;public UIntPtr wParam;public IntPtr lParam;public uint time;public int x,y;public uint extra;}
  [DllImport("user32.dll")] static extern bool PeekMessage(out Message message,IntPtr window,uint min,uint max,uint flags);
  [DllImport("user32.dll")] static extern bool TranslateMessage(ref Message message);
  [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref Message message);
  static void Pump(){Message message;while(PeekMessage(out message,IntPtr.Zero,0,0,1)){TranslateMessage(ref message);DispatchMessage(ref message);}Thread.Sleep(1);}
  readonly ManualResetEvent ready=new ManualResetEvent(false), hide=new ManualResetEvent(false), hidden=new ManualResetEvent(false), stop=new ManualResetEvent(false);
  Thread worker; public IntPtr Window; public Exception Error;
  public void Start(IntPtr desktop) {
    worker=new Thread(()=> {
      try {
        if(!SetThreadDesktop(desktop)) throw new Exception("Fixture desktop unavailable");
        Window=CreateWindowEx(0,"STATIC","Visibility regression",0x90000000,0,0,20,20,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero);
        if(Window==IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
        ready.Set(); while(!hide.WaitOne(0))Pump(); ShowWindow(Window,0); hidden.Set(); while(!stop.WaitOne(0))Pump();
      } catch(Exception error) {Error=error;ready.Set();hidden.Set();}
      finally {if(Window!=IntPtr.Zero) DestroyWindow(Window);}
    });
    worker.Start();
    if(!ready.WaitOne(5000)) throw new Exception("Fixture startup timeout");
    if(Error!=null) throw Error;
  }
  public void Hide() {hide.Set();if(!hidden.WaitOne(5000))throw new Exception("Fixture hide timeout");if(Error!=null)throw Error;}
  public void Dispose() {hide.Set();stop.Set();if(worker!=null&&!worker.Join(5000))throw new Exception("Fixture cleanup timeout");ready.Dispose();hide.Dispose();hidden.Dispose();stop.Dispose();}
}
'@
$name='EdgeFinderVisibilityTest'+[Guid]::NewGuid().ToString('N')
$desktop=[EdgeBackgroundDesktop]::CreateDesktop($name,[IntPtr]::Zero,[IntPtr]::Zero,0,0x10000000,[IntPtr]::Zero)
if($desktop -eq [IntPtr]::Zero){throw 'Cannot create isolated fixture desktop'}
$fixture=[VisibilityFixture]::new()
$passed=0
try {
  $fixture.Start($desktop)
  if([EdgeBackgroundDesktop]::IsInputDesktop($name)){throw 'Fixture must remain off the input desktop'}; $passed++
  if([EdgeBackgroundDesktop]::AnyVisible($name,[int[]]@(0))){throw 'Window must not match an unrelated process'}; $passed++
  if(-not [EdgeBackgroundDesktop]::AnyVisible($name,[int[]]@($PID))){throw 'Visible foreign-desktop window not detected'}; $passed++
  $fixture.Hide()
  if([EdgeBackgroundDesktop]::AnyVisible($name,[int[]]@($PID))){throw 'Hidden foreign-desktop window reported visible'}; $passed++
} finally { $fixture.Dispose(); [void][EdgeBackgroundDesktop]::CloseDesktop($desktop) }
[pscustomobject]@{passed=$passed;failed=0;realWin32=$true;vpnCalls=0;inputDesktopChanged=$false}|ConvertTo-Json -Compress
