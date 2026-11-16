param([string]$OutputBase)
$ErrorActionPreference='Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Collections.Concurrent;
public static class NbaFocus {
 public delegate void Callback(IntPtr h,uint e,IntPtr w,int o,int c,uint t,uint ms);
 [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint a,uint b,IntPtr m,Callback c,uint p,uint t,uint f);
 [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr h);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr w,out uint p);
 [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
 [StructLayout(LayoutKind.Sequential)] public struct MSG {public IntPtr h;public uint m;public UIntPtr w;public IntPtr l;public uint t;public int x,y;}
 [DllImport("user32.dll")] static extern bool PeekMessage(out MSG m,IntPtr h,uint a,uint b,uint r);
 static Callback cb=OnFocus; static IntPtr hook;
 public static ConcurrentQueue<string> Events=new ConcurrentQueue<string>();
 static void OnFocus(IntPtr h,uint e,IntPtr w,int o,int c,uint t,uint ms) {uint p;GetWindowThreadProcessId(w,out p);Events.Enqueue(DateTime.UtcNow.ToString("o")+"|"+p+"|"+w.ToInt64());}
 public static void Start(){hook=SetWinEventHook(3,3,IntPtr.Zero,cb,0,0,0);if(hook==IntPtr.Zero)throw new Exception("SetWinEventHook failed");OnFocus(IntPtr.Zero,3,GetForegroundWindow(),0,0,0,0);}
 public static void Pump(){MSG m;while(PeekMessage(out m,IntPtr.Zero,0,0,1)){} }
 public static void Stop(){UnhookWinEvent(hook);}
}
'@
$writer=[IO.StreamWriter]::new($OutputBase+'.jsonl',$false,[Text.UTF8Encoding]::new($false))
$writer.AutoFlush=$true
$started=[DateTimeOffset]::UtcNow.ToString('o');$count=0;$maxGap=0;$last=0
$clock=[Diagnostics.Stopwatch]::StartNew()
try {
 [NbaFocus]::Start()
 [IO.File]::WriteAllText($OutputBase+'.ready',"$PID")
 while(-not (Test-Path -LiteralPath ($OutputBase+'.stop')) -and $clock.Elapsed.TotalMinutes -lt 15){
  $maxGap=[Math]::Max($maxGap,$clock.ElapsedMilliseconds-$last);$last=$clock.ElapsedMilliseconds
  [NbaFocus]::Pump();$entry=$null
  while([NbaFocus]::Events.TryDequeue([ref]$entry)){
   $parts=$entry.Split('|');$ownerId=[int]$parts[1]
   $p=Get-CimInstance Win32_Process -Filter "ProcessId=$ownerId" -ErrorAction SilentlyContinue
   $row=@{at=$parts[0];pid=$ownerId;window=$parts[2];process=$p.Name;parentPid=$p.ParentProcessId;creationDate=$p.CreationDate;routineMarker=([string]$p.CommandLine -match 'EdgeFinder|edge_betano_persistent|9331|local_bookmaker|run_betano|background_bootstrap|tunnel_runner|nba_props_sample|NBA-Props')}
   $writer.WriteLine(($row | ConvertTo-Json -Compress));$count++
  }
  Start-Sleep -Milliseconds 10
 }
} finally {
 [NbaFocus]::Stop();$writer.Dispose()
 [IO.File]::WriteAllText($OutputBase+'.summary.json',(@{startedAt=$started;finishedAt=[DateTimeOffset]::UtcNow.ToString('o');events=$count;maxPumpGapMs=$maxGap;stoppedExplicitly=(Test-Path -LiteralPath ($OutputBase+'.stop'))} | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
}
